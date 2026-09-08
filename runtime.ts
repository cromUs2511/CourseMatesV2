import crypto from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { WebSocket, WebSocketServer } from 'ws';
import type { Server } from 'node:http';
import type { StudentSession } from './src/types';

type Identity = StudentSession & { id: string; expiresAt: number };
type Participant = { id: string; handle: string; avatar: string; campus?: string; discipline?: string; interests: string[]; ws?: WebSocket; lastSeen: number };
type Message = { id: string; senderId: string; senderHandle: string; senderAvatar: string; text: string; timestamp: number; type: 'text'; replyTo?: { id: string; senderHandle: string; text: string } };
type Room = { id: string; peers: [Participant, Participant]; topic: string; messages: Message[]; typing: Map<string, number> };
export const sessions = new Map<string, Identity>();
const queue = new Map<string, Participant>();
const rooms = new Map<string, Room>();
const matches = new Map<string, string>();
const sockets = new Map<string, WebSocket>();
const adjectives = ['Curious', 'Astute', 'Quantum', 'Keen', 'Creative', 'Luminous'];
const nouns = ['Cardinal', 'Coder', 'Architect', 'Scholar', 'Explorer', 'Engineer'];
export function generateAnonymousHandle() {
  return { handle: adjectives[crypto.randomInt(adjectives.length)] + ' ' + nouns[crypto.randomInt(nouns.length)] + ' #' + crypto.randomInt(1000, 10000), avatar: '' };
}
export const isSchoolEmail = (email: unknown): email is string =>
  typeof email === 'string' && email.length <= 254 && /^[a-z0-9.!#$%&'*+/=?^_\x60{|}~-]+@(mymail\.mapua\.edu\.ph|mymapua\.edu\.ph|mapua\.edu\.ph)$/i.test(email);
export function issueSession(email: string, profile: any = {}, verified = false): Identity {
  const { handle, avatar } = generateAnonymousHandle();
  const session: Identity = {
    id: crypto.randomUUID(), email, token: crypto.randomBytes(32).toString('hex'),
    isVerified: verified, isSchoolVerified: verified,
    campus: ['Intramuros', 'Makati', 'Laguna', 'Digital / Online'].includes(profile.campus) ? profile.campus : 'Intramuros',
    discipline: typeof profile.discipline === 'string' ? profile.discipline.slice(0, 100) : 'Computer Science & IT',
    interests: cleanInterests(profile.interests),
    sessionHandle: handle, customHandle: false, sessionAvatar: avatar, createdAt: Date.now(),
    expiresAt: Date.now() + 8 * 60 * 60 * 1000,
    authProvider: verified ? 'microsoft_entra_id' : 'demo',
  };
  sessions.set(session.token, session);
  return session;
}
function cleanInterests(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((v): v is string => typeof v === 'string').map(v => v.trim().slice(0, 100)).filter(Boolean))].slice(0, 16) : ['General Peer Discovery'];
}
function validSession(token: unknown) {
  const session = typeof token === 'string' ? sessions.get(token) : undefined;
  if (!session || session.expiresAt <= Date.now()) return undefined;
  return session;
}
export function cookie(req: Request, name: string) {
  const part = req.headers.cookie?.split(';').map(p => p.trim()).find(p => p.startsWith(name + '='));
  return part?.slice(name.length + 1);
}
export function authenticate(req: Request): Identity | undefined {
  const header = req.get('authorization');
  return validSession(header?.startsWith('Bearer ') ? header.slice(7) : cookie(req, 'cm_session'));
}
function publicPeer(peer: Participant) {
  return { sessionId: peer.id, handle: peer.handle, avatar: peer.avatar, campus: peer.campus, discipline: peer.discipline, interests: peer.interests };
}
function notify(ws: WebSocket | undefined, data: unknown) {
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function matchResult(id: string) {
  const room = rooms.get(matches.get(id) || '');
  if (!room) return null;
  const peer = room.peers.find(p => p.id !== id)!;
  return { status: 'matched', roomId: room.id, peer: publicPeer(peer), topic: room.topic };
}
function leave(id: string) {
  queue.delete(id);
  const roomId = matches.get(id);
  const room = rooms.get(roomId || '');
  if (!room) { matches.delete(id); return; }
  for (const peer of room.peers) {
    matches.delete(peer.id);
    notify(peer.ws, { type: 'peer_disconnected', roomId: room.id });
  }
  room.messages.length = 0;
  rooms.delete(room.id);
}
function join(session: Identity, data: any, ws?: WebSocket) {
  const existing = matchResult(session.id);
  if (existing) return existing;
  const participant: Participant = {
    id: session.id, handle: session.sessionHandle, avatar: session.sessionAvatar,
    campus: session.campus, discipline: session.discipline,
    interests: cleanInterests(data.interests), ws, lastSeen: Date.now(),
  };
  // A repeated join updates one queue entry; it cannot match with itself.
  queue.delete(session.id);
  const candidates = [...queue.values()].filter(p => Date.now() - p.lastSeen < 30000 && (!p.ws || p.ws.readyState === WebSocket.OPEN));
  const sameVerification = candidates.filter(p => [...sessions.values()].some(s => s.id === p.id && s.isVerified === session.isVerified));
  const peer = sameVerification.find(p => p.interests.some(i => participant.interests.includes(i))) || sameVerification[0];
  if (!peer) {
    queue.set(session.id, participant);
    return { status: 'queued', position: queue.size };
  }
  queue.delete(peer.id);
  const room: Room = {
    id: crypto.randomUUID(), peers: [peer, participant],
    topic: participant.interests.find(i => peer.interests.includes(i)) || participant.interests[0] || 'General Peer Discovery',
    messages: [], typing: new Map(),
  };
  rooms.set(room.id, room);
  for (const p of room.peers) matches.set(p.id, room.id);
  for (const p of room.peers) notify(p.ws, { type: 'matched', ...matchResult(p.id) });
  return matchResult(session.id)!;
}
function requireRoom(session: Identity, id: unknown) {
  const room = typeof id === 'string' ? rooms.get(id) : undefined;
  if (!room || !room.peers.some(p => p.id === session.id)) return undefined;
  room.peers.find(p => p.id === session.id)!.lastSeen = Date.now();
  return room;
}
function send(session: Identity, room: Room, data: any) {
  if (typeof data.text !== 'string' || !data.text.trim() || data.text.length > 4000) throw new Error('Messages must contain 1–4000 characters.');
  const id = typeof data.clientMessageId === 'string' && data.clientMessageId.length <= 100 ? data.clientMessageId : crypto.randomUUID();
  const duplicate = room.messages.find(m => m.id === id && m.senderId === session.id);
  if (duplicate) return duplicate;
  const message: Message = {
    id, senderId: session.id, senderHandle: session.sessionHandle, senderAvatar: session.sessionAvatar,
    text: data.text.trim(), timestamp: Date.now(), type: 'text',
    replyTo: typeof data.replyTo?.id === 'string' && typeof data.replyTo?.text === 'string'
      ? { id: data.replyTo.id, senderHandle: String(data.replyTo.senderHandle || '').slice(0, 100), text: String(data.replyTo.text).slice(0, 300) }
      : undefined,
  };
  room.messages.push(message);
  if (room.messages.length > 500) room.messages.shift();
  room.typing.delete(session.id);
  for (const peer of room.peers) notify(peer.ws, { type: 'new_message', roomId: room.id, message });
  return message;
}
function removeMessage(session: Identity, room: Room, messageId: unknown) {
  if (typeof messageId !== 'string') throw new Error('Invalid message.');
  const index = room.messages.findIndex(message => message.id === messageId);
  if (index < 0) throw new Error('Message not found.');
  if (room.messages[index].senderId !== session.id) throw new Error('You can only delete your own messages.');
  room.messages.splice(index, 1);
  for (const peer of room.peers) notify(peer.ws, { type: 'message_deleted', roomId: room.id, messageId });
}
export function attachRuntime(app: Express, server: Server) {
  app.use(['/api/match', '/api/chat', '/api/ai'], (req, res, next) => {
    if (!authenticate(req)) return res.status(401).json({ error: 'Your session expired. Please sign in again.' });
    next();
  });
  app.get('/api/auth/session', (req, res) => res.json({ session: authenticate(req) || null }));
  app.post('/api/auth/reroll', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Please sign in again.' });
    if (queue.has(session.id) || matches.has(session.id)) return res.status(409).json({ error: 'Leave the queue or chat before changing your handle.' });
    if (session.customHandle) return res.status(409).json({ error: 'Custom names cannot be shuffled. Edit or clear your name first.' });
    session.sessionHandle = generateAnonymousHandle().handle;
    res.json({ session });
  });
  app.post('/api/auth/handle', (req, res) => {
    const session = authenticate(req);
    if (!session) return res.status(401).json({ error: 'Please sign in again.' });
    if (queue.has(session.id) || matches.has(session.id)) return res.status(409).json({ error: 'Leave the queue or chat before changing your name.' });
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Your name must be 2–40 characters.' });
    session.sessionHandle = name;
    session.customHandle = true;
    res.json({ session });
  });
  app.post('/api/auth/logout', (req, res) => {
    const session = authenticate(req);
    if (session) {
      leave(session.id);
      sockets.get(session.id)?.close();
      sessions.delete(session.token);
    }
    res.clearCookie('cm_session', { path: '/' }).json({ success: true });
  });
  app.post('/api/match/join', (req, res) => {
    const session = authenticate(req)!;
    res.json(join(session, req.body, sockets.get(session.id)));
  });
  app.get(['/api/match/poll', '/api/match/status'], (req, res) => {
    const session = authenticate(req)!;
    const queued = queue.get(session.id);
    if (queued) queued.lastSeen = Date.now();
    res.json(matchResult(session.id) || { status: queued ? 'queued' : 'idle', position: queued ? [...queue.keys()].indexOf(session.id) + 1 : 0 });
  });
  app.post('/api/match/cancel', (req, res) => {
    leave(authenticate(req)!.id);
    res.json({ success: true });
  });
  app.post('/api/chat/send', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try { res.json({ success: true, message: send(session, room, req.body) }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.post('/api/chat/delete', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended or is unavailable.' });
    try { removeMessage(session, room, req.body.messageId); res.json({ success: true }); }
    catch (error) { res.status(400).json({ error: (error as Error).message }); }
  });
  app.get('/api/chat/messages', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.query.roomId);
    if (!room) return res.json({ active: false, messages: [], peerDisconnected: true, isPeerTyping: false });
    // Return the bounded buffer. Clients deduplicate by ID, including messages with identical timestamps.
    res.json({ active: true, messages: room.messages, peerDisconnected: false,
      isPeerTyping: [...room.typing].some(([id, timestamp]) => id !== session.id && Date.now() - timestamp < 3000) });
  });
  app.post('/api/chat/typing', (req, res) => {
    const session = authenticate(req)!;
    const room = requireRoom(session, req.body.roomId);
    if (!room) return res.status(404).json({ error: 'Chat ended.' });
    if (req.body.isTyping === true) room.typing.set(session.id, Date.now());
    else room.typing.delete(session.id);
    for (const peer of room.peers) if (peer.id !== session.id) notify(peer.ws, { type: 'peer_typing', roomId: room.id, isTyping: req.body.isTyping === true });
    res.json({ success: true });
  });
  app.post('/api/chat/leave', (req, res) => {
    const session = authenticate(req)!;
    if (requireRoom(session, req.body.roomId)) leave(session.id);
    res.json({ success: true });
  });
  app.get('/api/health', (_req, res) => res.json({ status: 'ok', engine: 'Node.js', queued: queue.size, activeRooms: rooms.size }));

  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  server.on('upgrade', (req, socket, head) => {
    if (req.url?.split('?')[0] !== '/ws/chat') return;
    const expectedOrigin = process.env.APP_URL || 'http://' + req.headers.host;
    if (req.headers.origin && req.headers.origin !== expectedOrigin && req.headers.origin !== 'https://' + req.headers.host) {
      socket.destroy(); return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws));
  });
  wss.on('connection', ws => {
    let session: Identity | undefined;
    const timeout = setTimeout(() => { if (!session) ws.close(1008, 'Authentication required'); }, 5000);
    ws.on('message', raw => {
      try {
        const data = JSON.parse(raw.toString());
        if (data.type === 'join_queue') {
          const incoming = validSession(data.token);
          if (!incoming || (session && session.id !== incoming.id)) { ws.close(1008, 'Invalid session'); return; }
          session = incoming;
          const previous = sockets.get(session.id);
          if (previous && previous !== ws) previous.close(1000, 'Connection replaced');
          sockets.set(session.id, ws);
          clearTimeout(timeout);
          const room = rooms.get(matches.get(session.id) || '');
          if (room) room.peers.find(p => p.id === session!.id)!.ws = ws;
          const result = join(session, data, ws);
          if (room || result.status === 'queued') notify(ws, { type: result.status, ...result });
          return;
        }
        if (!session || !validSession(session.token)) { ws.close(1008, 'Invalid session'); return; }
        if (data.type === 'leave_queue') { leave(session.id); return; }
        if (data.type === 'ping') {
          const queued = queue.get(session.id);
          if (queued) queued.lastSeen = Date.now();
          requireRoom(session, matches.get(session.id));
          notify(ws, { type: 'pong' });
          return;
        }
        const room = requireRoom(session, data.roomId);
        if (!room) return notify(ws, { type: 'error', error: 'Chat ended or is unavailable.' });
        if (data.type === 'send_message') send(session, room, data);
        else if (data.type === 'delete_message') removeMessage(session, room, data.messageId);
        else if (data.type === 'leave_room') leave(session.id);
      } catch { notify(ws, { type: 'error', error: 'Invalid request.' }); }
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      clearTimeout(timeout);
      if (session && sockets.get(session.id) === ws) {
        sockets.delete(session.id);
        // REST polling can continue the same room after a transport failure.
        const queued = queue.get(session.id);
        if (queued?.ws === ws) queued.ws = undefined;
        const room = rooms.get(matches.get(session.id) || '');
        const participant = room?.peers.find(p => p.id === session!.id);
        if (participant?.ws === ws) participant.ws = undefined;
      }
    });
  });
  const cleanup = setInterval(() => {
    for (const [id, p] of queue) if (Date.now() - p.lastSeen > 30000) queue.delete(id);
    for (const room of rooms.values()) if (room.peers.some(p => Date.now() - p.lastSeen > 30000)) leave(room.peers[0].id);
    for (const [token, session] of sessions) if (session.expiresAt <= Date.now()) {
      leave(session.id); sockets.get(session.id)?.close(); sessions.delete(token);
    }
  }, 5000);
  cleanup.unref();
  return () => { clearInterval(cleanup); for (const ws of wss.clients) ws.terminate(); wss.close(); };
}
