import { useEffect, useRef } from 'react';
import { Gamepad2, X, Target, GitBranch, Crown, HelpCircle, Brain } from 'lucide-react';
import {
  TicTacToeLogo,
  RockPaperScissorsLogo,
  ConnectFourLogo,
  ChessLogo,
  TriviaLogo,
  WouldYouRatherLogo,
} from './GameLogos';

export type GamesCatalogProps = {
  hasGame: boolean;
  hasChallenge: boolean;
  /** A live peer game (invitation or unfinished game) in this chat, if any. */
  activePeerGame?: { game: string; label: string } | null;
  onSelectUno: () => void;
  onSelectTicTacToe: () => void;
  onSelectRps: () => void;
  onSelectConnectFour: () => void;
  onSelectChess: () => void;
  onSelectTrivia: () => void;
  onSelectWyr: () => void;
  onClose: () => void;
};

export function GamesCatalogDialog({
  hasGame,
  hasChallenge,
  activePeerGame,
  onSelectUno,
  onSelectTicTacToe,
  onSelectRps,
  onSelectConnectFour,
  onSelectChess,
  onSelectTrivia,
  onSelectWyr,
  onClose,
}: GamesCatalogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  const unoHint = hasGame
    ? 'Open your table'
    : hasChallenge
      ? 'Answer the pending challenge in chat'
      : activePeerGame
        ? `Finish your current ${activePeerGame.label} game first`
        : 'Challenge this peer to a UNO duel';
  const unoDisabled = (hasChallenge && !hasGame) || !!activePeerGame;

  const peerState = (key: string, fallback: string) => {
    if (!activePeerGame) return { disabled: false, hint: fallback };
    if (activePeerGame.game === key) return { disabled: false, hint: 'Reopen your game' };
    return { disabled: true, hint: `Finish your current ${activePeerGame.label} game first` };
  };

  const ttt = peerState(
    'tictactoe',
    'Invite your peer to a live two-player game, or reopen your board.',
  );
  const rps = peerState('rps', 'Best of 3 — choose secretly, reveal together.');
  const cf = peerState('connectfour', 'Drop pieces, connect four to win.');
  const chess = peerState('chess', 'Full chess with castling, promotion, en passant.');
  const trivia = peerState('trivia', '10 questions, multiple choice, timed.');
  const wyr = peerState('wyr', 'Fun choices, reveal together, discuss after.');

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="games-catalog-title"
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 shadow-2xl backdrop:bg-black/65 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="games-catalog-title" className="font-semibold">
          Games
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close games catalog"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-400 dark:border-stone-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-sm text-stone-500 dark:text-stone-400">
        Pick a game to play with your peer.
      </p>
      <div className="mt-4 grid gap-2">
        <button
          type="button"
          id="chat-game-uno-btn"
          onClick={onSelectUno}
          disabled={unoDisabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <Gamepad2 className="h-4 w-4" /> UNO
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{unoHint}</span>
        </button>
        <button
          type="button"
          id="chat-game-tictactoe-btn"
          onClick={onSelectTicTacToe}
          disabled={ttt.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <TicTacToeLogo className="h-5 w-5" /> Tic Tac Toe
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{ttt.hint}</span>
        </button>
        <button
          type="button"
          id="chat-game-rps-btn"
          onClick={onSelectRps}
          disabled={rps.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <RockPaperScissorsLogo className="h-5 w-5" /> Rock Paper Scissors
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{rps.hint}</span>
        </button>
        <button
          type="button"
          id="chat-game-connectfour-btn"
          onClick={onSelectConnectFour}
          disabled={cf.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <ConnectFourLogo className="h-5 w-5" /> Connect Four
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{cf.hint}</span>
        </button>
        <button
          type="button"
          id="chat-game-chess-btn"
          onClick={onSelectChess}
          disabled={chess.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <ChessLogo className="h-5 w-5" /> Chess
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
            {chess.hint}
          </span>
        </button>
        <button
          type="button"
          id="chat-game-trivia-btn"
          onClick={onSelectTrivia}
          disabled={trivia.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <TriviaLogo className="h-5 w-5" /> Trivia
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
            {trivia.hint}
          </span>
        </button>
        <button
          type="button"
          id="chat-game-wyr-btn"
          onClick={onSelectWyr}
          disabled={wyr.disabled}
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <WouldYouRatherLogo className="h-5 w-5" /> Would You Rather
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">{wyr.hint}</span>
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="mt-4 w-full rounded-lg border border-stone-400 px-4 py-3 font-semibold dark:border-stone-600"
      >
        Cancel
      </button>
    </dialog>
  );
}
