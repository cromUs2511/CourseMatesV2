import React, { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Bot, RotateCw, Users } from 'lucide-react';
import { playChime } from '../utils/sound';
import { TicTacToeLogo } from './GameLogos';
import '../tictactoe.css';

type Mark = 'X' | 'O';
type Cell = Mark | null;
type Mode = 'bot' | 'local';

const LINES: [number, number, number][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const CELL_NAMES = [
  'top left',
  'top middle',
  'top right',
  'middle left',
  'centre',
  'middle right',
  'bottom left',
  'bottom middle',
  'bottom right',
];

const other = (mark: Mark): Mark => (mark === 'X' ? 'O' : 'X');

function findOutcome(board: Cell[]): Mark | 'draw' | null {
  for (const [a, b, c] of LINES) {
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return mark;
  }
  return board.every((cell) => cell !== null) ? 'draw' : null;
}

function emptyCells(board: Cell[]): number[] {
  const open: number[] = [];
  for (let index = 0; index < board.length; index++) if (!board[index]) open.push(index);
  return open;
}

/** Minimax: the bot sees the whole tree, the draw included. */
function scoreBoard(board: Cell[], turn: Mark, bot: Mark, depth: number): number {
  const outcome = findOutcome(board);
  if (outcome === 'draw') return 0;
  if (outcome) return outcome === bot ? 10 - depth : depth - 10;
  let best = turn === bot ? -Infinity : Infinity;
  for (const index of emptyCells(board)) {
    board[index] = turn;
    const value = scoreBoard(board, other(turn), bot, depth + 1);
    board[index] = null;
    best = turn === bot ? Math.max(best, value) : Math.min(best, value);
  }
  return best;
}

function chooseBotMove(board: Cell[], bot: Mark): number {
  const open = emptyCells(board);
  if (open.length === 0) return -1;
  // Take a win the moment it appears.
  for (const index of open) {
    board[index] = bot;
    const won = findOutcome(board) === bot;
    board[index] = null;
    if (won) return index;
  }
  // One move in four is played loose so a careful player can still win.
  if (Math.random() < 0.25) return open[Math.floor(Math.random() * open.length)]!;
  const scored = open.map((index) => {
    board[index] = bot;
    const value = scoreBoard(board, other(bot), bot, 1);
    board[index] = null;
    return { index, value };
  });
  scored.sort((a, b) => b.value - a.value);
  const best = scored[0]!.value;
  const pool = scored.filter((entry) => entry.value === best);
  return pool[Math.floor(Math.random() * pool.length)]!.index;
}

export type TicTacToeProps = {
  isDarkMode: boolean;
  onBack: () => void;
};

export function TicTacToe({ isDarkMode, onBack }: TicTacToeProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [board, setBoard] = useState<Cell[]>(() => Array<Cell>(9).fill(null));
  const [turn, setTurn] = useState<Mark>('X');
  const [starter, setStarter] = useState<Mark>('X');
  const [score, setScore] = useState({ X: 0, O: 0, draw: 0 });
  const scoredRef = useRef<string | null>(null);

  const outcome = findOutcome(board);
  const outcomeKey = outcome ?? 'playing';
  const gameOver = outcome !== null;
  const humanIsX = mode === 'bot';

  useEffect(() => {
    if (outcomeKey === 'playing') {
      scoredRef.current = null;
      return;
    }
    if (scoredRef.current === outcomeKey) return;
    scoredRef.current = outcomeKey;
    playChime('match');
    setScore((current) =>
      outcomeKey === 'draw'
        ? { ...current, draw: current.draw + 1 }
        : outcomeKey === 'X'
          ? { ...current, X: current.X + 1 }
          : { ...current, O: current.O + 1 },
    );
  }, [outcomeKey]);

  useEffect(() => {
    if (mode !== 'bot' || gameOver || turn !== 'O') return;
    const timer = setTimeout(() => {
      const move = chooseBotMove(board, 'O');
      if (move < 0) return;
      setBoard((current) => {
        if (current[move] || findOutcome(current)) return current;
        const next = [...current];
        next[move] = 'O';
        return next;
      });
      playChime('click');
      setTurn('X');
    }, 420);
    return () => clearTimeout(timer);
  }, [mode, gameOver, turn, board]);

  const play = (index: number) => {
    if (gameOver || board[index]) return;
    if (mode === 'bot' && turn !== 'X') return;
    setBoard((current) => {
      if (current[index] || findOutcome(current)) return current;
      const next = [...current];
      next[index] = turn;
      return next;
    });
    playChime('click');
    setTurn(other(turn));
  };

  const newRound = () => {
    const nextStarter = other(starter);
    setStarter(nextStarter);
    setTurn(nextStarter);
    setBoard(Array<Cell>(9).fill(null));
  };

  const start = (nextMode: Mode) => {
    setMode(nextMode);
    setStarter('X');
    setTurn('X');
    setBoard(Array<Cell>(9).fill(null));
  };

  const winningLine = LINES.find(
    ([a, b, c]) => board[a] && board[a] === board[b] && board[a] === board[c],
  );
  const status =
    outcome === 'draw'
      ? 'Draw game.'
      : outcome
        ? mode === 'bot'
          ? outcome === 'X'
            ? 'You win!'
            : 'The bot wins.'
          : `${outcome} takes the round.`
        : mode === 'bot'
          ? turn === 'X'
            ? 'Your move.'
            : 'Bot is thinking…'
          : `${turn} to move.`;

  if (!mode) {
    return (
      <div
        className={`ambient-grid flex-1 min-h-0 w-full h-full flex flex-col overflow-hidden ${
          isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
        }`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
          <button
            type="button"
            onClick={onBack}
            className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 md:py-1.5 md:text-xs"
          >
            <ArrowLeft className="h-3.5 w-3.5" /> Back to menu
          </button>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
            Tic Tac Toe
          </span>
        </div>
        <div className="flex h-full w-full flex-col items-center justify-center overflow-y-auto px-4 py-6">
          <div className="w-full max-w-md space-y-4">
            <div className="ui-surface rounded-2xl p-6 space-y-5">
              <div className="flex flex-col items-center text-center">
                <TicTacToeLogo className="h-20 w-20" />
                <h2 className="mt-4 text-xl font-bold tracking-tight text-stone-900 dark:text-white">
                  Tic Tac Toe
                </h2>
                <p className="mt-1 text-sm text-stone-500 dark:text-stone-400">
                  Three in a row wins. Take on the house bot, or pass the screen to a friend.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <button
                  id="ttt-play-bot-btn"
                  type="button"
                  onClick={() => start('bot')}
                  className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <Bot className="h-4 w-4" /> Play the bot
                  </span>
                  <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                    You are X, it is O. It rarely misses.
                  </span>
                </button>
                <button
                  id="ttt-play-friend-btn"
                  type="button"
                  onClick={() => start('local')}
                  className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
                >
                  <span className="flex items-center gap-2 text-sm font-bold">
                    <Users className="h-4 w-4" /> Two players
                  </span>
                  <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
                    Take turns on this device. Nothing leaves it.
                  </span>
                </button>
              </div>
            </div>
            <div className="ui-surface flex items-start gap-3 rounded-2xl p-4 text-xs text-stone-500 dark:text-stone-400">
              <span className="mt-0.5 h-4 w-4 shrink-0 rounded border border-stone-300 dark:border-stone-700" />
              <p>
                Rounds are scored for this visit only — close the page and the scoreboard starts
                fresh, like every other private session on CourseMates.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`ambient-grid flex-1 min-h-0 w-full h-full flex flex-col overflow-hidden ${
        isDarkMode ? 'bg-[#141312] text-stone-100' : 'bg-[#FAF8F5] text-stone-800'
      }`}
    >
      <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 dark:border-stone-800">
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 rounded-lg border border-stone-300 px-3.5 py-2.5 text-sm font-semibold transition-colors hover:bg-stone-100 dark:border-stone-700 dark:hover:bg-stone-800 md:py-1.5 md:text-xs"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to menu
        </button>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-500">
          {mode === 'bot' ? 'You vs bot' : 'Two players'} · Tic Tac Toe
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex h-full w-full max-w-md flex-col items-center justify-center gap-4 px-4 py-6">
          <div className="ui-surface w-full rounded-2xl p-5 text-center space-y-4">
            <p
              role="status"
              aria-live="polite"
              className={`text-sm font-bold ${gameOver ? 'text-stone-900 dark:text-white' : 'text-stone-600 dark:text-stone-300'}`}
            >
              {status}
            </p>

            <div
              className="ttt-board mx-auto grid w-full max-w-xs grid-cols-3 gap-2"
              role="group"
              aria-label="Tic Tac Toe board"
            >
              {board.map((cell, index) => {
                const inLine = winningLine?.includes(index) ?? false;
                return (
                  <button
                    key={index}
                    type="button"
                    onClick={() => play(index)}
                    disabled={gameOver || !!cell || (mode === 'bot' && turn !== 'X')}
                    aria-label={`Cell ${CELL_NAMES[index]}, ${cell ?? 'empty'}`}
                    className={`ttt-cell flex aspect-square items-center justify-center rounded-xl border text-4xl font-black transition-colors disabled:cursor-default ${
                      isDarkMode
                        ? 'border-stone-700 bg-stone-900/70 hover:border-stone-500'
                        : 'border-stone-200 bg-white hover:border-stone-400'
                    } ${inLine ? 'ttt-cell-win' : ''}`}
                  >
                    {cell && (
                      <span
                        className={`ttt-mark ${cell === 'X' ? 'text-red-600' : 'text-amber-700'}`}
                      >
                        {cell}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <div className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl border border-stone-200 bg-stone-50 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  {humanIsX ? 'You (X)' : 'X'}
                </div>
                <div className="text-lg font-black text-red-600">{score.X}</div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  Draws
                </div>
                <div className="text-lg font-black text-stone-700 dark:text-stone-200">
                  {score.draw}
                </div>
              </div>
              <div className="rounded-xl border border-stone-200 bg-stone-50 py-2 dark:border-stone-800 dark:bg-stone-900/60">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-500">
                  {humanIsX ? 'Bot (O)' : 'O'}
                </div>
                <div className="text-lg font-black text-amber-700">{score.O}</div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={newRound}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-stone-900 py-3 text-sm font-bold text-white transition-colors hover:bg-stone-700 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-200"
              >
                <RotateCw className="h-4 w-4" /> New round
              </button>
              <button
                type="button"
                onClick={() => setMode(null)}
                className="w-full rounded-xl border border-stone-300 py-2.5 text-xs font-semibold text-stone-600 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:text-stone-300 dark:hover:bg-stone-800"
              >
                Choose another opponent
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
