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
