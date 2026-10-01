import { useEffect, useRef } from 'react';
import { Gamepad2, X } from 'lucide-react';
import { TicTacToeLogo } from './GameLogos';

export type GamesCatalogProps = {
  hasGame: boolean;
  hasChallenge: boolean;
  onSelectUno: () => void;
  onSelectTicTacToe: () => void;
  onClose: () => void;
};

export function GamesCatalogDialog({
  hasGame,
  hasChallenge,
  onSelectUno,
  onSelectTicTacToe,
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
      : 'Challenge this peer to a UNO duel';

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
          disabled={hasChallenge && !hasGame}
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
          className="rounded-xl border border-stone-200 bg-white/60 p-3.5 text-left transition-colors hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900/50 dark:hover:bg-stone-800"
        >
          <span className="flex items-center gap-2 text-sm font-bold">
            <TicTacToeLogo className="h-5 w-5" /> Tic Tac Toe
          </span>
          <span className="mt-1 block text-xs text-stone-500 dark:text-stone-400">
            Invite your peer to a live two-player game, or reopen your board.
          </span>
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
