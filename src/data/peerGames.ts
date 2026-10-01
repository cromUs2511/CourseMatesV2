export type TicTacToeMark = 'X' | 'O';
export type TicTacToeState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string; mark: TicTacToeMark }[];
    board: (TicTacToeMark | null)[];
    turn: TicTacToeMark;
    result: TicTacToeMark | 'draw' | null;
    winningLine: number[];
    rematch: string[];
  } | null;
};

export type TicTacToeAction =
  | { action: 'invite' }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | { action: 'move'; gameId: string; round: number; revision: number; square: number }
  | { action: 'rematch'; gameId: string; round: number };

export type RpsChoice = 'rock' | 'paper' | 'scissors';
export type RpsState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string; choice: RpsChoice | null }[];
    choices: { [playerId: string]: RpsChoice };
    scores: { [playerId: string]: number };
    turn: 'choosing' | 'revealing' | 'round-end';
    result: { winnerId: string | null; reason: string } | null;
    bestOf: number;
    rematch: string[];
  } | null;
};

export type RpsAction =
  | { action: 'invite' }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | { action: 'choose'; gameId: string; round: number; revision: number; choice: RpsChoice }
  | { action: 'next'; gameId: string; round: number; revision: number }
  | { action: 'rematch'; gameId: string; round: number };

export type ConnectFourState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string; color: 'red' | 'yellow' }[];
    board: (('red' | 'yellow') | null)[][];
    turn: 'red' | 'yellow';
    result: { winnerId: string | null; winningCells: number[] } | null;
    lastMove: { row: number; col: number } | null;
    rematch: string[];
  } | null;
};

export type ConnectFourAction =
  | { action: 'invite' }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | { action: 'move'; gameId: string; round: number; revision: number; column: number }
  | { action: 'rematch'; gameId: string; round: number };

export type ChessPieceType = 'pawn' | 'rook' | 'knight' | 'bishop' | 'queen' | 'king';
export type ChessPieceColor = 'white' | 'black';
export type ChessPiece = { type: ChessPieceType; color: ChessPieceColor; hasMoved?: boolean };
export type ChessSquare = ChessPiece | null;
export type ChessBoard = ChessSquare[][];

export type ChessState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string; color: ChessPieceColor }[];
    board: ChessBoard;
    /** Server-authoritative position (castling rights, en passant, clocks). */
    fen: string;
    turn: ChessPieceColor;
    result: {
      winnerId: string | null;
      reason: 'checkmate' | 'stalemate' | 'resignation' | 'draw-agreed';
    } | null;
    inCheck: ChessPieceColor | null;
    lastMove: { from: [number, number]; to: [number, number]; piece: ChessPiece } | null;
    drawOfferedBy: string | null;
    rematch: string[];
  } | null;
};

export type ChessAction =
  | { action: 'invite' }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | {
      action: 'move';
      gameId: string;
      round: number;
      revision: number;
      from: [number, number];
      to: [number, number];
      promotion?: ChessPieceType;
    }
  | { action: 'offerDraw'; gameId: string; round: number; revision: number }
  | { action: 'respondDraw'; gameId: string; round: number; revision: number; accept: boolean }
  | { action: 'resign'; gameId: string; round: number; revision: number }
  | { action: 'rematch'; gameId: string; round: number };

export type TriviaCategory =
  'general' | 'science' | 'technology' | 'gaming' | 'movies' | 'music' | 'history' | 'random';
export type TriviaQuestion = {
  id: string;
  question: string;
  options: string[];
  correctIndex: number;
  category: TriviaCategory;
};
export type TriviaState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string }[];
    questions: TriviaQuestion[];
    currentQuestionIndex: number;
    answers: { [playerId: string]: { answerIndex: number; timestamp: number } };
    scores: { [playerId: string]: number };
    timerEndsAt: number;
    phase: 'waiting' | 'answering' | 'revealing' | 'round-end' | 'game-end';
    result: { winnerId: string | null; finalScores: { [playerId: string]: number } } | null;
    category: TriviaCategory;
    rematch: string[];
  } | null;
};

export type TriviaAction =
  | { action: 'invite'; category: TriviaCategory }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | { action: 'answer'; gameId: string; round: number; revision: number; answerIndex: number }
  | { action: 'next'; gameId: string; round: number; revision: number }
  | { action: 'rematch'; gameId: string; round: number };

export type WyrChoice = 'A' | 'B';
export type WyrQuestion = {
  id: string;
  text: string;
  optionA: string;
  optionB: string;
  category: string;
};
export type WyrState = {
  revision: number;
  invitation: { id: string; fromId: string; fromHandle: string; expiresAt: number } | null;
  game: {
    id: string;
    round: number;
    players: { id: string; handle: string }[];
    questions: WyrQuestion[];
    currentQuestionIndex: number;
    choices: { [playerId: string]: WyrChoice };
    phase: 'waiting' | 'choosing' | 'revealing' | 'round-end';
    result: { sameChoice: boolean } | null;
    category: string;
    rematch: string[];
  } | null;
};

export type WyrAction =
  | { action: 'invite'; category: string }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | { action: 'choose'; gameId: string; round: number; revision: number; choice: WyrChoice }
  | { action: 'next'; gameId: string; round: number; revision: number }
  | { action: 'rematch'; gameId: string; round: number };

export type PeerGameKey = 'tictactoe' | 'rps' | 'connectfour' | 'chess' | 'trivia' | 'wyr';

/** Compact live status reported to the chat shell for the generic game indicator. */
export type PeerGameActivity = {
  game: PeerGameKey;
  label: string;
  status: string;
  incoming: boolean;
};
