export const DRAW_CATEGORIES = {
  all: 'All ideas',
  animals: 'Animals',
  food: 'Food & drinks',
  objects: 'Everyday objects',
  nature: 'Nature',
  places: 'Places',
  sports: 'Sports',
  technology: 'Technology',
  campus: 'Campus life',
  actions: 'Actions',
  funny: 'Funny scenarios',
} as const;
export type DrawCategory = keyof typeof DRAW_CATEGORIES;
export type DrawDifficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export const DRAW_DIFFICULTIES: Record<DrawDifficulty, string> = {
  mixed: 'Mixed',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};
export const DRAW_COLORS = [
  '#292524',
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#ec4899',
  '#a16207',
] as const;
export type DrawPoint = { x: number; y: number };
export type DrawStroke = {
  id: string;
  color: string;
  width: number;
  eraser: boolean;
  points: DrawPoint[];
};
export type DrawChoice = {
  id: string;
  word: string;
  category: Exclude<DrawCategory, 'all'>;
  difficulty: Exclude<DrawDifficulty, 'mixed'>;
};
export type DrawGame = {
  id: string;
  round: number;
  players: { id: string; handle: string }[];
  drawerId: string;
  phase: 'choosing' | 'drawing' | 'reveal' | 'finished';
  deadline: number;
  choices: DrawChoice[];
  word: string | null;
  hint: string;
  category: DrawCategory;
  difficulty: DrawDifficulty;
  promptCategory: string;
  strokes: DrawStroke[];
  canvasVersion: number;
  guesses: { id: string; text: string; correct: boolean }[];
  scores: Record<string, number>;
  result: { winnerId: string | null } | null;
  solved: boolean;
  rematch: string[];
};
export type DrawGuessState = {
  serverNow?: number;
  revision: number;
  invitation: {
    id: string;
    fromId: string;
    fromHandle: string;
    expiresAt: number;
    category: DrawCategory;
    difficulty: DrawDifficulty;
  } | null;
  game: DrawGame | null;
  leftBy: { id: string; handle: string } | null;
};
type Turn = { gameId: string; round: number };
export type DrawGuessAction =
  | { action: 'invite'; category: DrawCategory; difficulty: DrawDifficulty }
  | { action: 'respond'; invitationId: string; accept: boolean }
  | ({ action: 'choose'; choiceId: string } & Turn)
  | ({
      action: 'stroke';
      canvasVersion: number;
      strokeId: string;
      offset: number;
      color: string;
      width: number;
      eraser: boolean;
      points: DrawPoint[];
    } & Turn)
  | ({ action: 'clear'; canvasVersion: number } & Turn)
  | ({ action: 'undo'; canvasVersion: number } & Turn)
  | ({ action: 'guess'; text: string } & Turn)
  | ({ action: 'next' | 'rematch' } & Turn)
  | { action: 'leave' };
