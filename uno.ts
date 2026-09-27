import crypto from 'node:crypto';
import {
  UNO_COLORS,
  type UnoCard,
  type UnoColor,
  type UnoSource,
  type UnoValue,
  type UnoViewerState,
} from './unoTypes';

export type { UnoCard, UnoColor, UnoSource, UnoValue, UnoViewerState } from './unoTypes';
export { UNO_COLORS } from './unoTypes';

type UnoPlayer = { id: string; handle: string; hand: UnoCard[]; calledUno: boolean };

const NUMBER_VALUES: UnoValue[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

function shuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    const swap = items[i]!;
    items[i] = items[j]!;
    items[j] = swap;
  }
  return items;
}

/** Standard 108-card deck: 100 coloured cards + 8 wilds. */
export function buildUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const color of UNO_COLORS) {
    deck.push({ id: crypto.randomUUID(), color, value: '0' });
    for (let copy = 0; copy < 2; copy++) {
      for (const value of NUMBER_VALUES) deck.push({ id: crypto.randomUUID(), color, value });
      deck.push({ id: crypto.randomUUID(), color, value: 'skip' });
      deck.push({ id: crypto.randomUUID(), color, value: 'reverse' });
      deck.push({ id: crypto.randomUUID(), color, value: '+2' });
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push({ id: crypto.randomUUID(), color: 'black', value: 'wild' });
    deck.push({ id: crypto.randomUUID(), color: 'black', value: 'wild+4' });
  }
  return shuffle(deck);
}

export function unoCardIsPlayable(card: UnoCard, top: UnoCard, activeColor: UnoColor): boolean {
  if (card.color === 'black') return true;
  if (card.color === activeColor) return true;
  if (card.value === top.value) return true;
  return false;
}

export class UnoGame {
  readonly id = crypto.randomUUID();
  readonly source: UnoSource;
  readonly roomId?: string;
  readonly players: [UnoPlayer, UnoPlayer];
  deck: UnoCard[] = [];
  discard: UnoCard[] = [];
  turn: 0 | 1 = 0;
  direction: 1 | -1 = 1;
  activeColor: UnoColor = 'red';
  hasDrawn: [boolean, boolean] = [false, false];
  status: 'playing' | 'over' = 'playing';
  winner: 0 | 1 | null = null;
  notice = '';
  createdAt = Date.now();
  lastSeen = Date.now();

  constructor(
    first: { id: string; handle: string },
    second: { id: string; handle: string },
    source: UnoSource,
    roomId?: string,
  ) {
    this.source = source;
    this.roomId = roomId;
    this.players = [
      { id: first.id, handle: first.handle, hand: [], calledUno: false },
      { id: second.id, handle: second.handle, hand: [], calledUno: false },
    ];
    this.start();
  }

  private drawFromDeck(): UnoCard {
    if (this.deck.length === 0) {
      const top = this.discard.pop();
      this.deck = shuffle(this.discard);
      this.discard = top ? [top] : [];
      if (top) this.notice = 'Reshuffled the discard pile into the draw deck.';
    }
    const card = this.deck.pop();
    if (!card) throw new Error('The deck is empty.');
    return card;
  }

  private start(): void {
    this.deck = buildUnoDeck();
    this.discard = [];
    this.direction = 1;
    this.turn = crypto.randomInt(2) as 0 | 1;
    this.hasDrawn = [false, false];
    this.status = 'playing';
    this.winner = null;
    for (const player of this.players) {
      player.hand = [];
      player.calledUno = false;
      for (let round = 0; round < 7; round++) player.hand.push(this.drawFromDeck());
    }
    let first = this.drawFromDeck();
    while (first.value === 'wild+4') {
      this.deck.unshift(first);
      this.deck = shuffle(this.deck);
      first = this.drawFromDeck();
    }
    this.discard.push(first);
    this.activeColor =
      first.color === 'black' ? UNO_COLORS[crypto.randomInt(UNO_COLORS.length)]! : first.color;
    const starter = this.players[this.turn]!;
    if (first.value === 'skip') {
      this.turn = this.nextIndex();
      this.notice = `Opening card was Skip — ${this.players[this.turn]!.handle} starts.`;
    } else if (first.value === 'reverse') {
      this.direction = -1;
      this.notice = 'Opening card was Reverse — play order reversed.';
    } else if (first.value === '+2') {
      starter.hand.push(this.drawFromDeck(), this.drawFromDeck());
      this.turn = this.nextIndex();
      this.notice = `Opening +2! ${starter.handle} drew 2 and was skipped.`;
    } else {
      this.notice = `Game on — ${starter.handle} starts.`;
    }
  }

  private nextIndex(step = 1): 0 | 1 {
    const raw = this.turn + this.direction * step;
    return (((raw % 2) + 2) % 2) as 0 | 1;
  }

  private top(): UnoCard {
    return this.discard[this.discard.length - 1]!;
  }

  /** Called when a turn ends without a win: catch a missing UNO call. */
  private applyUnoPenalty(actor: number): void {
    const player = this.players[actor]!;
    if (player.hand.length !== 1 || player.calledUno) return;
    player.hand.push(this.drawFromDeck(), this.drawFromDeck());
    player.calledUno = false;
    this.notice += ` ${player.handle} forgot to call UNO — drew 2!`;
  }

  private endTurn(actor: number): void {
    this.applyUnoPenalty(actor);
    const player = this.players[actor]!;
    if (player.hand.length > 1) player.calledUno = false;
    this.hasDrawn = [false, false];
    this.turn = this.nextIndex();
    if (this.status === 'playing') this.notice += ` Waiting on ${this.players[this.turn]!.handle}.`;
  }

  play(sessionId: string, cardId: string, color?: UnoColor): void {
    this.touch();
    if (this.status !== 'playing') throw new Error('This game is already over.');
    const actor = this.indexOf(sessionId);
    if (actor !== this.turn) throw new Error('It is not your turn.');
    const player = this.players[actor]!;
    const index = player.hand.findIndex((card) => card.id === cardId);
    if (index === -1) throw new Error('That card is not in your hand.');
    const card = player.hand[index]!;
    if (!unoCardIsPlayable(card, this.top(), this.activeColor))
      throw new Error("That card doesn't match the colour or value.");
    if (card.color === 'black' && !UNO_COLORS.includes(color!))
      throw new Error('Choose a colour for the wild card.');

    player.hand.splice(index, 1);
    this.discard.push(card);
    this.hasDrawn[actor] = false;
    // UNO is called for the player: one card left means the call already stands.
    if (player.hand.length === 1) player.calledUno = true;
    const top = card;
    if (card.color === 'black') this.activeColor = color!;
    else this.activeColor = card.color;

    if (player.hand.length === 0) {
      this.status = 'over';
      this.winner = actor;
      this.notice = `${player.handle} cleared their hand — game over!`;
      return;
    }

    let skipVictim = false;
    let penalty = 0;
    if (card.value === 'skip') {
      skipVictim = true;
      this.notice = `${player.handle} played Skip.`;
    } else if (card.value === 'reverse') {
      if (this.players.length === 2) {
        skipVictim = true;
        this.notice = `${player.handle} played Reverse — in 1v1 it acts as Skip.`;
      } else {
        this.direction = (this.direction * -1) as 1 | -1;
        this.notice = `${player.handle} reversed the order.`;
      }
    } else if (card.value === '+2') {
      penalty = 2;
      skipVictim = true;
      this.notice = `${player.handle} played +2!`;
    } else if (card.value === 'wild+4') {
      penalty = 4;
      skipVictim = true;
      this.notice = `${player.handle} played Wild +4 on ${this.activeColor.toUpperCase()}!`;
    } else {
      this.notice = `${player.handle} played ${card.color.toUpperCase()} ${top.value.toUpperCase()}.`;
    }
    if (player.hand.length === 1) this.notice += ' — UNO!';

    if (penalty > 0) {
      const victimIndex = this.nextIndex();
      const victim = this.players[victimIndex]!;
      for (let i = 0; i < penalty; i++) victim.hand.push(this.drawFromDeck());
      victim.calledUno = false;
      this.notice += ` ${victim.handle} drew ${penalty}.`;
    }

    this.applyUnoPenalty(actor);
    this.hasDrawn = [false, false];
    this.turn = this.nextIndex(skipVictim || penalty > 0 ? 2 : 1);
    const played = this.players[actor]!;
    if (played.hand.length > 1) played.calledUno = false;
    if (this.status === 'playing') this.notice += ` Waiting on ${this.players[this.turn]!.handle}.`;
  }

  draw(sessionId: string): UnoCard {
    this.touch();
    if (this.status !== 'playing') throw new Error('This game is already over.');
    const actor = this.indexOf(sessionId);
    if (actor !== this.turn) throw new Error('It is not your turn.');
    if (this.hasDrawn[actor]) throw new Error('You already drew — play that card or pass.');
    const player = this.players[actor]!;
    const card = this.drawFromDeck();
    player.hand.push(card);
    if (player.hand.length > 1) player.calledUno = false;
    this.hasDrawn[actor] = true;
    this.notice = `${player.handle} drew a card.`;
    return card;
  }

  pass(sessionId: string): void {
    this.touch();
    if (this.status !== 'playing') throw new Error('This game is already over.');
    const actor = this.indexOf(sessionId);
    if (actor !== this.turn) throw new Error('It is not your turn.');
    if (!this.hasDrawn[actor]) throw new Error('Draw a card before passing.');
    this.notice = `${this.players[actor]!.handle} passed.`;
    this.endTurn(actor);
  }

  callUno(sessionId: string): void {
    this.touch();
    if (this.status !== 'playing') throw new Error('This game is already over.');
    const actor = this.indexOf(sessionId);
    const player = this.players[actor]!;
    player.calledUno = true;
    this.notice =
      player.hand.length === 1
        ? `${player.handle} called UNO!`
        : `${player.handle} called UNO early.`;
  }

  private indexOf(sessionId: string): number {
    const index = this.players.findIndex((player) => player.id === sessionId);
    if (index === -1) throw new Error('You are not in this game.');
    return index;
  }

  touch(): void {
    this.lastSeen = Date.now();
  }

  forfeit(sessionId: string): void {
    if (this.status !== 'playing') return;
    const loser = this.players.findIndex((player) => player.id === sessionId);
    if (loser === -1) return;
    this.status = 'over';
    this.winner = loser === 0 ? 1 : 0;
    this.notice = `${this.players[loser]!.handle} left the table.`;
  }

  abort(): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = null;
    this.notice = 'The game ended — the table timed out.';
  }

  stateFor(sessionId: string): UnoViewerState | null {
    const youIndex = this.players.findIndex((player) => player.id === sessionId);
    if (youIndex === -1) return null;
    const opponentIndex = youIndex === 0 ? 1 : 0;
    const you = this.players[youIndex]!;
    const opponent = this.players[opponentIndex]!;
    const playable =
      this.status === 'playing' && this.turn === youIndex
        ? you.hand
            .filter((card) => unoCardIsPlayable(card, this.top(), this.activeColor))
            .map((card) => card.id)
        : [];
    return {
      gameId: this.id,
      source: this.source,
      roomId: this.roomId,
      you: { handle: you.handle, hand: you.hand, calledUno: you.calledUno },
      opponent: {
        handle: opponent.handle,
        handCount: opponent.hand.length,
        calledUno: opponent.calledUno,
      },
      top: this.top(),
      activeColor: this.activeColor,
      direction: this.direction,
      turn: this.turn === youIndex ? 'you' : 'opponent',
      deckCount: this.deck.length,
      hasDrawn: this.hasDrawn[youIndex] === true,
      playable,
      status: this.status,
      winner:
        this.status === 'over'
          ? this.winner === null
            ? null
            : this.winner === youIndex
              ? 'you'
              : 'opponent'
          : null,
      notice: this.notice,
    };
  }
}

export type UnoChallenge = {
  id: string;
  fromId: string;
  fromHandle: string;
  toId: string;
  toHandle: string;
  roomId: string;
  createdAt: number;
  lastSeen: number;
};

type ArenaEntry = { id: string; handle: string; joinedAt: number; lastSeen: number };

const arena = new Map<string, ArenaEntry>();
const games = new Map<string, UnoGame>();
const gameBySession = new Map<string, string>();
const challenges = new Map<string, UnoChallenge>();

export const UNO_LIMITS = { games: 500, arena: 500, challenges: 500 };

export function unoStats() {
  return { games: games.size, arena: arena.size, challenges: challenges.size };
}

/** Wipe every table — used when the runtime shuts down or a test server stops. */
export function unoReset(): void {
  arena.clear();
  games.clear();
  gameBySession.clear();
  challenges.clear();
}

export function unoGameForSession(sessionId: string): UnoGame | undefined {
  const gameId = gameBySession.get(sessionId);
  const game = gameId ? games.get(gameId) : undefined;
  if (!game) {
    gameBySession.delete(sessionId);
    return undefined;
  }
  return game;
}

export function unoChallengeForSession(sessionId: string): UnoChallenge | undefined {
  for (const challenge of challenges.values())
    if (challenge.fromId === sessionId || challenge.toId === sessionId) return challenge;
  return undefined;
}

function registerGame(game: UnoGame): UnoGame {
  games.set(game.id, game);
  gameBySession.set(game.players[0].id, game.id);
  gameBySession.set(game.players[1].id, game.id);
  return game;
}

function dropSession(sessionId: string): void {
  const challenge = unoChallengeForSession(sessionId);
  if (challenge) challenges.delete(challenge.id);
  arena.delete(sessionId);
}

/** Pair with the longest-waiting opponent, or take a seat in the arena lobby. */
export function joinArena(
  sessionId: string,
  handle: string,
): { status: 'waiting' | 'matched'; gameId?: string } {
  const active = unoGameForSession(sessionId);
  if (active) return { status: 'matched', gameId: active.id };
  if (unoChallengeForSession(sessionId)) throw new Error('Answer the UNO challenge first.');
  const existing = arena.get(sessionId);
  if (existing) {
    existing.lastSeen = Date.now();
    existing.handle = handle;
    return { status: 'waiting' };
  }
  const waiting = [...arena.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
  if (waiting && waiting.id !== sessionId) {
    arena.delete(waiting.id);
    const game = registerGame(
      new UnoGame({ id: waiting.id, handle: waiting.handle }, { id: sessionId, handle }, 'arena'),
    );
    return { status: 'matched', gameId: game.id };
  }
  if (arena.size >= UNO_LIMITS.arena) throw new Error('The UNO arena is full right now.');
  arena.set(sessionId, { id: sessionId, handle, joinedAt: Date.now(), lastSeen: Date.now() });
  return { status: 'waiting' };
}

export function leaveArena(sessionId: string): void {
  arena.delete(sessionId);
}

/** Open a 1v1 challenge against the other player in a chat room. */
export function createUnoChallenge(
  from: { id: string; handle: string },
  to: { id: string; handle: string },
  roomId: string,
): UnoChallenge {
  if (from.id === to.id) throw new Error('You cannot challenge yourself.');
  if (unoGameForSession(from.id) || unoGameForSession(to.id))
    throw new Error('One of you is already at a UNO table.');
  const existing = unoChallengeForSession(from.id) || unoChallengeForSession(to.id);
  if (existing) {
    if (existing.fromId === from.id && existing.toId === to.id) {
      existing.lastSeen = Date.now();
      return existing;
    }
    throw new Error('There is already a challenge waiting.');
  }
  if (challenges.size >= UNO_LIMITS.challenges) throw new Error('Too many challenges right now.');
  const challenge: UnoChallenge = {
    id: crypto.randomUUID(),
    fromId: from.id,
    fromHandle: from.handle,
    toId: to.id,
    toHandle: to.handle,
    roomId,
    createdAt: Date.now(),
    lastSeen: Date.now(),
  };
  challenges.set(challenge.id, challenge);
  return challenge;
}

export function respondToChallenge(
  challengeId: string,
  sessionId: string,
  accept: boolean,
): { challenge: UnoChallenge; game?: UnoGame } {
  const challenge = challenges.get(challengeId);
  if (!challenge) throw new Error('That challenge is no longer available.');
  if (challenge.toId !== sessionId && challenge.fromId !== sessionId)
    throw new Error('That challenge is not for you.');
  if (accept && challenge.toId !== sessionId)
    throw new Error('Only the challenged peer can accept.');
  challenges.delete(challengeId);
  if (!accept) return { challenge };
  dropSession(challenge.fromId);
  dropSession(challenge.toId);
  const game = registerGame(
    new UnoGame(
      { id: challenge.fromId, handle: challenge.fromHandle },
      { id: challenge.toId, handle: challenge.toHandle },
      'room',
      challenge.roomId,
    ),
  );
  return { challenge, game };
}

export function cancelChallenge(challengeId: string, sessionId: string): UnoChallenge {
  const challenge = challenges.get(challengeId);
  if (!challenge) throw new Error('That challenge is no longer available.');
  if (challenge.fromId !== sessionId && challenge.toId !== sessionId)
    throw new Error('That challenge is not for you.');
  challenges.delete(challengeId);
  return challenge;
}

export function unoStateFor(sessionId: string): {
  game: UnoViewerState | null;
  challenge: {
    id: string;
    direction: 'incoming' | 'outgoing';
    fromHandle: string;
    roomId: string;
  } | null;
  queued: boolean;
} {
  const game = unoGameForSession(sessionId);
  if (game) game.touch();
  const challenge = unoChallengeForSession(sessionId);
  if (challenge) challenge.lastSeen = Date.now();
  return {
    game: game ? game.stateFor(sessionId) : null,
    challenge: challenge
      ? {
          id: challenge.id,
          direction: challenge.toId === sessionId ? 'incoming' : 'outgoing',
          fromHandle: challenge.fromId === sessionId ? challenge.toHandle : challenge.fromHandle,
          roomId: challenge.roomId,
        }
      : null,
    queued: arena.has(sessionId),
  };
}

/** A session that disappears (logout, expiry) forfeits its table. */
export function unoDropSession(sessionId: string): UnoGame[] {
  const ended: UnoGame[] = [];
  const game = unoGameForSession(sessionId);
  if (game) {
    game.forfeit(sessionId);
    ended.push(game);
  }
  dropSession(sessionId);
  return ended;
}

/** Leaving a chat room ends only the room game/challenge, never an arena table. */
export function unoLeaveRoom(sessionId: string, roomId?: string): UnoGame[] {
  if (!roomId) return [];
  const ended: UnoGame[] = [];
  const game = unoGameForSession(sessionId);
  if (game && game.source === 'room' && game.roomId === roomId) {
    game.forfeit(sessionId);
    ended.push(game);
  }
  const challenge = unoChallengeForSession(sessionId);
  if (challenge && challenge.roomId === roomId) challenges.delete(challenge.id);
  return ended;
}

/**
 * A player walks away from their own table: they lose, the opponent keeps the
 * result, and only the leaver stops seeing the game.
 */
export function unoLeaveGame(sessionId: string): UnoGame | undefined {
  const game = unoGameForSession(sessionId);
  if (game && game.status === 'playing') game.forfeit(sessionId);
  gameBySession.delete(sessionId);
  arena.delete(sessionId);
  const challenge = unoChallengeForSession(sessionId);
  if (challenge) challenges.delete(challenge.id);
  if (game) {
    const observed = game.players.some((player) => gameBySession.get(player.id) === game.id);
    if (!observed) removeUnoGame(game.id);
  }
  return game;
}

export function removeUnoGame(gameId: string): void {
  const game = games.get(gameId);
  if (!game) return;
  games.delete(gameId);
  for (const player of game.players)
    if (gameBySession.get(player.id) === gameId) gameBySession.delete(player.id);
}

export function unoCleanup(now = Date.now()): UnoGame[] {
  const expired: UnoGame[] = [];
  for (const [id, entry] of arena) if (now - entry.lastSeen > 30000) arena.delete(id);
  for (const [id, challenge] of challenges)
    if (now - challenge.lastSeen > 60000 || now - challenge.createdAt > 5 * 60000)
      challenges.delete(id);
  for (const [id, game] of [...games]) {
    if (game.status === 'playing' && now - game.lastSeen > 90000) {
      game.abort();
      expired.push(game);
    } else if (game.status === 'over' && now - game.lastSeen > 5 * 60000) {
      removeUnoGame(id);
    }
  }
  return expired;
}
