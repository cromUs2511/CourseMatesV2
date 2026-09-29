/** Shared UNO types — imported by both the Node runtime and the browser, so
 *  this module must stay free of Node-only imports. */

export type UnoColor = 'red' | 'blue' | 'green' | 'yellow';
export const UNO_COLORS: UnoColor[] = ['red', 'blue', 'green', 'yellow'];
export type UnoCardColor = UnoColor | 'black';
export type UnoValue =
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | 'skip'
  | 'reverse'
  | '+2'
  | 'wild'
  | 'wild+4';
export type UnoCard = { id: string; color: UnoCardColor; value: UnoValue };
export type UnoSource = 'arena' | 'room';

/** Every seat a table can hold: classic 1v1, or a four player table. */
export type UnoTableSize = 2 | 4;

/** One of the other seats — hand count only, never the cards themselves. */
export type UnoOpponentView = {
  handle: string;
  handCount: number;
  calledUno: boolean;
  seat: number;
  bot: boolean;
  active: boolean;
};

/** What one player is allowed to see: their own hand, never another seat's. */
export type UnoViewerState = {
  gameId: string;
  source: UnoSource;
  roomId?: string;
  size: UnoTableSize;
  you: { handle: string; hand: UnoCard[]; calledUno: boolean; seat: number };
  /** The closest rival seat; kept for 1v1 clients. */
  opponent: { handle: string; handCount: number; calledUno: boolean };
  opponents: UnoOpponentView[];
  top: UnoCard;
  activeColor: UnoColor;
  direction: 1 | -1;
  turn: 'you' | 'opponent';
  turnHandle: string;
  turnSeat: number;
  deckCount: number;
  hasDrawn: boolean;
  playable: string[];
  status: 'playing' | 'over';
  winner: 'you' | 'opponent' | null;
  winnerHandle: string | null;
  notice: string;
};

export type UnoChallengeView = {
  id: string;
  direction: 'incoming' | 'outgoing';
  fromHandle: string;
  roomId: string;
};

export type UnoStateResponse = {
  game: UnoViewerState | null;
  challenge: UnoChallengeView | null;
  queued: boolean;
};

export type UnoAction = {
  action: 'play' | 'draw' | 'pass' | 'uno';
  gameId?: string;
  cardId?: string;
  color?: UnoColor;
};
