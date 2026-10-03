import crypto from 'node:crypto';
import {
  UNO_COLORS,
  type UnoCard,
  type UnoColor,
  type UnoOpponentView,
  type UnoSource,
  type UnoTableSize,
  type UnoValue,
  type UnoViewerState,
} from './unoTypes';

export type {
  UnoCard,
  UnoColor,
  UnoSource,
  UnoTableSize,
  UnoValue,
  UnoViewerState,
} from './unoTypes';
export { UNO_COLORS } from './unoTypes';

/** One seat at a table. A bot seat is played by the server, never by a client. */
export type UnoSeat = { id: string; handle: string; bot?: boolean };

type UnoPlayer = {
  id: string;
  handle: string;
  hand: UnoCard[];
  calledUno: boolean;
  bot: boolean;
};

/** A table always has its first two seats; a four player table adds two more. */
export type UnoPlayers = UnoPlayer[] & { 0: UnoPlayer; 1: UnoPlayer };

const NUMBER_VALUES: UnoValue[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
const BOT_NAMES = [
  'Nova',
  'Pixel',
  'Echo',
  'Orbit',
  'Quartz',
  'Juno',
  'Volt',
  'Ripple',
  'Comet',
  'Piper',
];

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
  readonly players: UnoPlayers;
  readonly size: UnoTableSize;
  deck: UnoCard[] = [];
  discard: UnoCard[] = [];
  turn = 0;
  direction: 1 | -1 = 1;
  activeColor: UnoColor = 'red';
  hasDrawn: boolean[] = [false, false];
  status: 'playing' | 'over' = 'playing';
  winner: number | null = null;
  notice = '';
  createdAt = Date.now();
  lastSeen = Date.now();
  round = 1;
  rematchRequests = new Set<string>();
  awayBy: Set<string> = new Set();
  awayDeadline = 0;
  autoEndAt = 0;

  constructor(
    first: UnoSeat,
    second: UnoSeat,
    source: UnoSource,
    roomId?: string,
    extraSeats: UnoSeat[] = [],
  ) {
    const seats = [first, second, ...extraSeats];
    if (seats.length !== 2 && seats.length !== 4)
      throw new Error('A UNO table seats two or four players.');
    this.source = source;
    this.roomId = roomId;
    this.size = seats.length;
    this.players = seats.map((seat) => ({
      id: seat.id,
      handle: seat.handle,
      hand: [],
      calledUno: false,
      bot: seat.bot === true,
    })) as unknown as UnoPlayers;
    this.start();
  }

  get hasBots(): boolean {
    return this.players.some((player) => player.bot);
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
    this.turn = crypto.randomInt(this.players.length);
    this.hasDrawn = this.players.map(() => false);
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

  private seatAfter(index: number, step = 1): number {
    const seats = this.players.length;
    const raw = index + this.direction * step;
    return ((raw % seats) + seats) % seats;
  }

  private nextIndex(step = 1): number {
    return this.seatAfter(this.turn, step);
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
    this.hasDrawn = this.players.map(() => false);
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
    } else if (card.value === 'wild') {
      this.notice = `${player.handle} played Wild — colour is now ${this.activeColor.toUpperCase()}.`;
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
    this.hasDrawn = this.players.map(() => false);
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

  /** The colour the bot holds the most of — wilds are resolved with it. */
  private bestColor(player: UnoPlayer): UnoColor {
    const counts = new Map<UnoColor, number>();
    for (const card of player.hand)
      if (card.color !== 'black') counts.set(card.color, (counts.get(card.color) ?? 0) + 1);
    let best: UnoColor = UNO_COLORS[crypto.randomInt(UNO_COLORS.length)]!;
    for (const color of UNO_COLORS)
      if ((counts.get(color) ?? 0) > (counts.get(best) ?? 0)) best = color;
    return best;
  }

  /** Keeps its own colour, punishes a leader, and saves wilds for later. */
  private chooseBotCard(playable: UnoCard[], player: UnoPlayer, actor: number): UnoCard {
    const held = new Map<UnoColor, number>();
    for (const card of player.hand)
      if (card.color !== 'black') held.set(card.color, (held.get(card.color) ?? 0) + 1);
    const rivals = this.players.filter(
      (other, index) => index !== actor && other.hand.length <= 2,
    ).length;
    const scored = playable.map((card) => {
      let score = 0;
      if (card.color !== 'black') score += 4 + (held.get(card.color) ?? 0);
      if (card.value === '+2' || card.value === 'wild+4') score += 2 + rivals;
      if (card.value === 'skip' || card.value === 'reverse') score += 1 + rivals;
      if (card.color === 'black') score -= 2;
      if (player.hand.length === 2 && card.color !== 'black') score += 6;
      return { card, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0]!.score;
    const top = scored.filter((entry) => entry.score === best);
    return top[crypto.randomInt(top.length)]!.card;
  }

  /** One bot decision: play the best legal card, else draw, else pass. */
  private botTurn(): void {
    const actor = this.turn;
    const player = this.players[actor]!;
    const playable = player.hand.filter((card) =>
      unoCardIsPlayable(card, this.top(), this.activeColor),
    );
    if (playable.length > 0) {
      const card = this.chooseBotCard(playable, player, actor);
      this.play(player.id, card.id, card.color === 'black' ? this.bestColor(player) : undefined);
      return;
    }
    if (!this.hasDrawn[actor]) {
      this.draw(player.id);
      return;
    }
    this.pass(player.id);
  }

  /**
   * Play every bot seat in turn until a human is up. Called while building a
   * view, so a table with bots always answers "whose turn is it" honestly.
   */
  advanceBots(): void {
    if (this.status !== 'playing' || !this.hasBots) return;
    let budget = this.players.length * 4;
    try {
      while (budget-- > 0 && this.status === 'playing' && this.players[this.turn]?.bot)
        this.botTurn();
    } catch {
      // A table never fails a read because a bot quirk; the timeout still ends it.
      this.lastSeen = Date.now();
    }
  }

  touch(): void {
    this.lastSeen = Date.now();
  }

  /** The seat that deserves the table when another one walks away. */
  private crownWithout(leaver: number): number {
    let best = -1;
    for (let index = 0; index < this.players.length; index++) {
      if (index === leaver) continue;
      if (best === -1 || this.players[index]!.hand.length < this.players[best]!.hand.length)
        best = index;
    }
    return best === -1 ? leaver : best;
  }

  forfeit(sessionId: string): void {
    if (this.status !== 'playing') return;
    const loser = this.players.findIndex((player) => player.id === sessionId);
    if (loser === -1) return;
    this.status = 'over';
    this.winner =
      this.source === 'room' && process.env.CHAT_MULTIPLAYER_V2 !== 'false'
        ? null
        : this.crownWithout(loser);
    this.notice = `${this.players[loser]!.handle} left the table.`;
  }

  rematch(sessionId: string, round?: number): void {
    this.indexOf(sessionId);
    if (this.status !== 'over' || this.winner === null)
      throw new Error('Finish the match before requesting a rematch.');
    if (round !== undefined && round !== this.round) throw new Error('That round has ended.');
    this.rematchRequests.add(sessionId);
    this.touch();
    if (this.players.every((player) => this.rematchRequests.has(player.id))) {
      this.round++;
      this.rematchRequests.clear();
      this.start();
    }
  }

  abort(): void {
    if (this.status !== 'playing') return;
    this.status = 'over';
    this.winner = null;
    this.notice = 'The game ended — the table timed out.';
  }

  private updateAwayState(now = Date.now()): void {
    if (this.status !== 'playing') {
      this.awayBy.clear();
      this.awayDeadline = 0;
      this.autoEndAt = 0;
      return;
    }
    const activeIds = new Set(this.players.map((player) => player.id));
    for (const id of [...this.awayBy]) {
      if (!activeIds.has(id)) this.awayBy.delete(id);
    }
    const awayCount = this.awayBy.size;
    if (awayCount === 0) {
      this.awayDeadline = 0;
      this.autoEndAt = 0;
      return;
    }
    if (awayCount > 1) {
      this.awayDeadline = 0;
      this.autoEndAt = 0;
      return;
    }
    if (!this.awayDeadline) this.awayDeadline = now + 30000;
    this.autoEndAt = this.awayDeadline;
    if (now >= this.awayDeadline) {
      const leaverId = [...this.awayBy][0]!;
      const leaver = this.players.find((player) => player.id === leaverId);
      this.status = 'over';
      this.winner =
        this.source === 'room' && process.env.CHAT_MULTIPLAYER_V2 !== 'false'
          ? null
          : this.players.findIndex((player) => player.id !== leaverId);
      this.notice = leaver
        ? `${leaver.handle} left or minimized the table.`
        : 'A player left or minimized the table.';
      this.awayBy.clear();
      this.awayDeadline = 0;
      this.autoEndAt = 0;
    }
  }

  markAway(sessionId: string, away: boolean, now = Date.now()): void {
    if (this.status !== 'playing') return;
    const index = this.players.findIndex((player) => player.id === sessionId);
    if (index === -1) return;
    // Focus/blur events repeat constantly; only a real change may touch the
    // notice or bump the revision, or every client re-renders and flickers.
    if (this.awayBy.has(sessionId) === away) return;
    if (away) this.awayBy.add(sessionId);
    else this.awayBy.delete(sessionId);
    this.updateAwayState(now);
    if (this.status === 'playing') {
      this.notice = away
        ? `${this.players[index]!.handle} went away — the other player has 30 seconds before the table ends.`
        : `${this.players[index]!.handle} rejoined the table.`;
    }
    this.touch();
  }

  stateFor(sessionId: string): UnoViewerState | null {
    const now = Date.now();
    this.updateAwayState(now);
    const youIndex = this.players.findIndex((player) => player.id === sessionId);
    if (youIndex === -1) return null;
    const you = this.players[youIndex]!;
    const opponents: UnoOpponentView[] = [];
    for (let index = 0; index < this.players.length; index++) {
      if (index === youIndex) continue;
      const seat = this.players[index]!;
      opponents.push({
        handle: seat.handle,
        handCount: seat.hand.length,
        calledUno: seat.calledUno,
        seat: index,
        bot: seat.bot,
        active: this.status === 'playing' && this.turn === index,
      });
    }
    const rival = this.players[this.seatAfter(youIndex)]!;
    const playable =
      this.status === 'playing' && this.turn === youIndex
        ? you.hand
            .filter((card) => unoCardIsPlayable(card, this.top(), this.activeColor))
            .map((card) => card.id)
        : [];
    const opponentAway = this.status === 'playing' && this.awayBy.has(rival.id);
    const yourAway = this.status === 'playing' && this.awayBy.has(sessionId);
    const awayCountdownMs =
      this.status === 'playing' && this.awayBy.size > 0 && this.awayDeadline > 0
        ? Math.max(0, this.awayDeadline - now)
        : 0;
    return {
      gameId: this.id,
      source: this.source,
      roomId: this.roomId,
      size: this.size,
      you: { handle: you.handle, hand: you.hand, calledUno: you.calledUno, seat: youIndex },
      opponent: {
        handle: rival.handle,
        handCount: rival.hand.length,
        calledUno: rival.calledUno,
      },
      opponents,
      top: this.top(),
      activeColor: this.activeColor,
      direction: this.direction,
      turn: this.turn === youIndex ? 'you' : 'opponent',
      turnHandle: this.players[this.turn]!.handle,
      turnSeat: this.turn,
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
      winnerHandle:
        this.status === 'over' && this.winner !== null ? this.players[this.winner]!.handle : null,
      notice: this.notice,
      opponentAway,
      opponentCountdownMs: opponentAway ? awayCountdownMs : 0,
      youAway: yourAway,
      awayCountdownMs: yourAway ? awayCountdownMs : 0,
      round: this.round,
      rematchRequested: this.rematchRequests.has(sessionId),
      opponentRequestedRematch: [...this.rematchRequests].some((id) => id !== sessionId),
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

type ArenaEntry = {
  id: string;
  handle: string;
  size: UnoTableSize;
  joinedAt: number;
  lastSeen: number;
};

const arena = new Map<string, ArenaEntry>();
const games = new Map<string, UnoGame>();
const gameBySession = new Map<string, string>();
const challenges = new Map<string, UnoChallenge>();
let snapshotRevision = 0;

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
  for (const player of game.players) gameBySession.set(player.id, game.id);
  return game;
}

function dropSession(sessionId: string): void {
  const challenge = unoChallengeForSession(sessionId);
  if (challenge) challenges.delete(challenge.id);
  arena.delete(sessionId);
}

function seatGame(seats: UnoSeat[], source: UnoSource, roomId?: string): UnoGame {
  return registerGame(
    new UnoGame(seats[0]!, seats[1]!, source, roomId, seats.slice(2).length ? seats.slice(2) : []),
  );
}

/** Pair with the longest-waiting opponent of the same table size. */
export function joinArena(
  sessionId: string,
  handle: string,
  size: UnoTableSize = 2,
): { status: 'waiting' | 'matched'; gameId?: string } {
  const active = unoGameForSession(sessionId);
  if (active) return { status: 'matched', gameId: active.id };
  if (unoChallengeForSession(sessionId)) throw new Error('Answer the UNO challenge first.');
  const existing = arena.get(sessionId);
  if (existing) {
    existing.lastSeen = Date.now();
    existing.handle = handle;
    existing.size = size;
    return { status: 'waiting' };
  }
  const waiting = [...arena.values()]
    .filter((entry) => entry.size === size && entry.id !== sessionId)
    .sort((a, b) => a.joinedAt - b.joinedAt);
  const needed = size - 1;
  if (waiting.length >= needed) {
    const partners = waiting.slice(0, needed);
    for (const partner of partners) arena.delete(partner.id);
    const seats: UnoSeat[] = [...partners, { id: sessionId, handle }];
    const game = seatGame(seats, 'arena');
    return { status: 'matched', gameId: game.id };
  }
  if (arena.size >= UNO_LIMITS.arena) throw new Error('The UNO arena is full right now.');
  arena.set(sessionId, { id: sessionId, handle, size, joinedAt: Date.now(), lastSeen: Date.now() });
  return { status: 'waiting' };
}

export function leaveArena(sessionId: string): void {
  arena.delete(sessionId);
}

/**
 * Fill the empty seats with bots so nobody has to wait: one human, the rest
 * played by the server with the same rules as everybody else.
 */
export function startBotGame(sessionId: string, handle: string, size: UnoTableSize = 2): UnoGame {
  const active = unoGameForSession(sessionId);
  if (active) return active;
  if (unoChallengeForSession(sessionId)) throw new Error('Answer the UNO challenge first.');
  arena.delete(sessionId);
  if (games.size >= UNO_LIMITS.games) throw new Error('The UNO arena is full right now.');
  const names = [...BOT_NAMES];
  const seats: UnoSeat[] = [{ id: sessionId, handle }];
  for (let index = 1; index < size; index++) {
    const pick = names.splice(crypto.randomInt(names.length), 1)[0] ?? `Bot ${index}`;
    seats.push({ id: `bot_${crypto.randomUUID()}`, handle: `Bot ${pick}`, bot: true });
  }
  return seatGame(seats, 'arena');
}

/** Open a 1v1 challenge against the other player in a chat room. */
export function createUnoChallenge(
  from: { id: string; handle: string },
  to: { id: string; handle: string },
  roomId: string,
): UnoChallenge {
  if (from.id === to.id) throw new Error('You cannot challenge yourself.');
  for (const player of [from, to]) {
    const previous = unoGameForSession(player.id);
    if (previous?.status === 'over') unoLeaveGame(player.id);
  }
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
  if (Date.now() - challenge.createdAt > 90000) {
    challenges.delete(challengeId);
    throw new Error('That invitation expired. Send a new one.');
  }
  if (accept && games.size >= UNO_LIMITS.games) throw new Error('Too many tables right now.');
  challenges.delete(challengeId);
  if (!accept) return { challenge };
  dropSession(challenge.fromId);
  dropSession(challenge.toId);
  const game = seatGame(
    [
      { id: challenge.fromId, handle: challenge.fromHandle },
      { id: challenge.toId, handle: challenge.toHandle },
    ],
    'room',
    challenge.roomId,
  );
  return { challenge, game };
}

export function cancelChallenge(challengeId: string, sessionId: string): UnoChallenge {
  const challenge = challenges.get(challengeId);
  if (!challenge) throw new Error('That challenge is no longer available.');
  if (challenge.toId !== sessionId && challenge.fromId !== sessionId)
    throw new Error('That challenge is not for you.');
  challenges.delete(challengeId);
  return challenge;
}

export function unoStateFor(sessionId: string): {
  revision: number;
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
  if (game) {
    game.advanceBots();
    game.touch();
  }
  const challenge = unoChallengeForSession(sessionId);
  if (challenge) challenge.lastSeen = Date.now();
  // A lobby seat lives as long as its holder keeps asking for the state.
  const seat = arena.get(sessionId);
  if (seat) seat.lastSeen = Date.now();
  return {
    revision: ++snapshotRevision,
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
 * A player walks away from their own table: they lose, the table keeps its
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
    if (now - challenge.lastSeen > 60000 || now - challenge.createdAt > 90000)
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
