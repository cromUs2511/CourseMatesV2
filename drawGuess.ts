import crypto from 'node:crypto';
import { DRAW_PROMPTS } from './drawGuessPrompts';
import {
  DRAW_CATEGORIES,
  DRAW_DIFFICULTIES,
  DRAW_COLORS,
  type DrawGuessState,
  type DrawGuessAction,
  type DrawGame,
  type DrawChoice,
} from './src/data/drawGuess';

const normalize = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
const ANSWER_ALIASES: Record<string, string[]> = {
  phone: ['telephone', 'cellphone', 'cell phone', 'mobile phone'],
  television: ['tv'],
  fridge: ['refrigerator'],
  airplane: ['aeroplane', 'plane'],
  football: ['soccer ball', 'football ball'],
  soccer: ['playing football', 'playing soccer'],
  donut: ['doughnut'],
  'hot dog': ['hotdog'],
  'french fries': ['fries'],
  'wifi router': ['wi fi router', 'wireless router'],
  'game console': ['gaming console'],
  'USB drive': ['flash drive', 'thumb drive'],
  'VR headset': ['virtual reality headset'],
  'graduation cap': ['mortarboard'],
  'jump rope': ['skipping rope'],
  'table tennis': ['ping pong'],
  'trash can': ['garbage bin', 'rubbish bin'],
  ladybug: ['ladybird'],
  flashlight: ['torch'],
  'cotton candy': ['candy floss'],
  eraser: ['rubber'],
};
export function matchesDrawAnswer(word: string, guess: string): boolean {
  const target = normalize(guess);
  return [word, ...(ANSWER_ALIASES[word] ?? [])].some((answer) => normalize(answer) === target);
}
export class PeerDrawGuess {
  private state: DrawGuessState = { revision: 0, invitation: null, game: null, leftBy: null };
  private used = new Set<string>();
  private choices: DrawChoice[] = [];
  private answer: DrawChoice | null = null;
  private lastGuessAt = -Infinity;

  snapshot(now = Date.now()): DrawGuessState {
    if (this.state.invitation && now >= this.state.invitation.expiresAt) {
      this.state.invitation = null;
      this.state.revision++;
    }
    const g = this.state.game;
    if (g?.phase === 'choosing' && now >= g.deadline) {
      this.select(g, this.choices[0]!, g.deadline);
      this.state.revision++;
    }
    if (g?.phase === 'drawing' && now >= g.deadline) {
      this.reveal(g, false);
      this.state.revision++;
    }
    return { ...structuredClone(this.state), serverNow: now };
  }

  serializeFor(viewerId: string, now = Date.now()): DrawGuessState {
    const state = this.snapshot(now);
    const g = state.game;
    if (!g) return state;
    g.choices =
      g.phase === 'choosing' && g.drawerId === viewerId ? structuredClone(this.choices) : [];
    g.word =
      this.answer && (g.drawerId === viewerId || g.phase === 'reveal' || g.phase === 'finished')
        ? this.answer.word
        : null;
    return state;
  }

  private offer(g: DrawGame, now: number) {
    const pool = DRAW_PROMPTS.filter(
      (p) =>
        !this.used.has(p.id) &&
        (g.category === 'all' || p.category === g.category) &&
        (g.difficulty === 'mixed' || p.difficulty === g.difficulty),
    );
    if (pool.length < 3) throw new Error('Not enough unused prompts in this category.');
    this.choices = [];
    for (let i = 0; i < 3; i++) {
      const p = pool.splice(crypto.randomInt(pool.length), 1)[0]!;
      this.choices.push(p);
      this.used.add(p.id);
    }
    this.answer = null;
    this.lastGuessAt = -Infinity;
    g.drawerId = g.players[(g.round - 1) % 2]!.id;
    g.phase = 'choosing';
    g.deadline = now + 20000;
    g.word = null;
    g.hint = '';
    g.promptCategory = '';
    g.strokes = [];
    g.guesses = [];
    g.canvasVersion++;
    g.solved = false;
  }

  private select(g: DrawGame, prompt: DrawChoice, now: number) {
    this.answer = prompt;
    this.choices = [];
    g.phase = 'drawing';
    g.deadline = now + 60000;
    g.promptCategory = DRAW_CATEGORIES[prompt.category];
    g.hint = prompt.word.replace(/[\p{L}\p{N}]/gu, '_');
  }

  private reveal(g: DrawGame, solved: boolean) {
    g.solved = solved;
    g.phase = g.round === 6 ? 'finished' : 'reveal';
    if (g.phase === 'finished') {
      const [a, b] = g.players;
      const sa = g.scores[a!.id]!,
        sb = g.scores[b!.id]!;
      g.result = { winnerId: sa === sb ? null : sa > sb ? a!.id : b!.id };
    }
  }

  private begin(
    players: DrawGame['players'],
    category: DrawGame['category'],
    difficulty: DrawGame['difficulty'],
    now: number,
  ) {
    this.used.clear();
    const g: DrawGame = {
      id: crypto.randomUUID(),
      round: 1,
      players: structuredClone(players),
      drawerId: players[0]!.id,
      phase: 'choosing',
      deadline: 0,
      choices: [],
      word: null,
      hint: '',
      category,
      difficulty,
      promptCategory: '',
      strokes: [],
      canvasVersion: -1,
      guesses: [],
      scores: Object.fromEntries(players.map((p) => [p.id, 0])),
      result: null,
      solved: false,
      rematch: [],
    };
    this.offer(g, now);
    this.state.game = g;
  }

  act(
    actor: string,
    peers: { id: string; handle: string }[],
    action: DrawGuessAction,
    now = Date.now(),
  ): void {
    if (peers.length !== 2 || !peers.some((p) => p.id === actor))
      throw new Error('This game is for the two current chat participants.');
    this.snapshot(now);
    if (!action || typeof action !== 'object') throw new Error('Invalid game action.');
    const s = this.state;
    if (action.action === 'invite') {
      if (!Object.hasOwn(DRAW_CATEGORIES, action.category))
        throw new Error('Choose a valid category.');
      if (!Object.hasOwn(DRAW_DIFFICULTIES, action.difficulty))
        throw new Error('Choose a valid difficulty.');
      if (s.invitation || s.game) throw new Error('Open the current game or leave it first.');
      s.invitation = {
        id: crypto.randomUUID(),
        fromId: actor,
        fromHandle: peers.find((p) => p.id === actor)!.handle,
        expiresAt: now + 90000,
        category: action.category,
        difficulty: action.difficulty,
      };
      s.leftBy = null;
    } else if (action.action === 'respond') {
      const inv = s.invitation;
      if (!inv || inv.id !== action.invitationId)
        throw new Error('That invitation is no longer available.');
      if (typeof action.accept !== 'boolean') throw new Error('Choose accept or decline.');
      if (action.accept && inv.fromId === actor)
        throw new Error('Only your peer can accept this invitation.');
      if (action.accept)
        this.begin(
          [peers.find((p) => p.id === inv.fromId)!, peers.find((p) => p.id !== inv.fromId)!],
          inv.category,
          inv.difficulty,
          now,
        );
      s.invitation = null;
      s.leftBy = null;
    } else if (action.action === 'leave') {
      s.leftBy = s.game ? { ...peers.find((p) => p.id === actor)! } : null;
      s.game = null;
      s.invitation = null;
      this.choices = [];
      this.answer = null;
      this.used.clear();
    } else {
      const g = s.game;
      if (!g || action.gameId !== g.id || action.round !== g.round)
        throw new Error('That round is no longer available.');
      if (action.action === 'choose') {
        if (actor !== g.drawerId) throw new Error('Only the drawer can choose.');
        if (g.phase !== 'choosing') throw new Error('The drawing turn has already started.');
        const prompt = this.choices.find((p) => p.id === action.choiceId);
        if (!prompt) throw new Error('Choose one of the offered prompts.');
        this.select(g, prompt, now);
      } else if (
        action.action === 'stroke' ||
        action.action === 'undo' ||
        action.action === 'clear'
      ) {
        if (actor !== g.drawerId) throw new Error('Only the drawer can draw.');
        if (g.phase !== 'drawing') throw new Error('This drawing turn is over.');
        if (action.canvasVersion !== g.canvasVersion)
          throw new Error('The canvas changed. Try again.');
        if (action.action === 'clear' || action.action === 'undo') {
          if (action.action === 'clear') g.strokes = [];
          else g.strokes.pop();
          g.canvasVersion++;
        } else {
          const { points, strokeId, offset, color, width, eraser } = action;
          if (
            !Array.isArray(points) ||
            points.length < 1 ||
            points.length > 64 ||
            points.some(
              (p) =>
                !p ||
                !Number.isFinite(p.x) ||
                !Number.isFinite(p.y) ||
                p.x < 0 ||
                p.x > 1 ||
                p.y < 0 ||
                p.y > 1,
            )
          )
            throw new Error('Invalid drawing points.');
          if (
            typeof strokeId !== 'string' ||
            !/^[a-zA-Z0-9-]{1,64}$/.test(strokeId) ||
            !Number.isInteger(offset) ||
            offset < 0 ||
            !DRAW_COLORS.includes(color as (typeof DRAW_COLORS)[number]) ||
            ![3, 5, 10].includes(width) ||
            typeof eraser !== 'boolean'
          )
            throw new Error('Invalid drawing tool or stroke.');
          let stroke = g.strokes.find((p) => p.id === strokeId);
          if (
            stroke &&
            (stroke.color !== color || stroke.width !== width || stroke.eraser !== eraser)
          )
            throw new Error('Stroke tool changed.');
          if (stroke && offset < stroke.points.length) {
            if (
              offset + points.length <= stroke.points.length &&
              points.every(
                (p, i) =>
                  p.x === stroke!.points[offset + i]!.x && p.y === stroke!.points[offset + i]!.y,
              )
            )
              return;
            throw new Error('Stroke batches are out of order.');
          }
          if (offset !== (stroke?.points.length ?? 0))
            throw new Error('Stroke batches are out of order.');
          if (
            (stroke?.points.length ?? 0) + points.length > 2048 ||
            g.strokes.reduce((n, p) => n + p.points.length, 0) + points.length > 12000 ||
            (!stroke && g.strokes.length >= 300)
          )
            throw new Error('Canvas is full. Undo or clear to keep drawing.');
          if (!stroke) {
            stroke = { id: strokeId, color, width, eraser, points: [] };
            g.strokes.push(stroke);
          }
          stroke.points.push(...points.map((p) => ({ x: p.x, y: p.y })));
        }
      } else if (action.action === 'guess') {
        if (actor === g.drawerId) throw new Error('Only the guesser can guess.');
        if (g.phase !== 'drawing') throw new Error('This drawing turn is over.');
        if (typeof action.text !== 'string' || action.text.length > 80 || !normalize(action.text))
          throw new Error('Enter a guess of 1–80 characters.');
        if (now - this.lastGuessAt < 1000 || g.guesses.length >= 60)
          throw new Error('Wait a second before guessing again.');
        this.lastGuessAt = now;
        const correct = matchesDrawAnswer(this.answer!.word, action.text);
        g.guesses.push({ id: crypto.randomUUID(), text: action.text.trim(), correct });
        if (correct) {
          g.scores[g.drawerId]! += 100;
          g.scores[actor]! +=
            100 + Math.max(0, Math.min(60, Math.floor((g.deadline - now) / 1000)));
          this.reveal(g, true);
        }
      } else if (action.action === 'next') {
        if (g.phase !== 'reveal') throw new Error('Finish the current drawing turn first.');
        g.round++;
        this.offer(g, now);
      } else if (action.action === 'rematch') {
        if (g.phase !== 'finished') throw new Error('Finish the match first.');
        if (g.rematch.includes(actor)) return;
        g.rematch.push(actor);
        if (g.rematch.length === 2)
          this.begin([...g.players].reverse(), g.category, g.difficulty, now);
      } else throw new Error('Invalid game action.');
    }
    s.revision++;
  }
}
