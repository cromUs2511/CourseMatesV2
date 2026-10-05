import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';

/** Two-tap leave button for in-chat game dialogs. Leaving clears the match server-side. */
export function LeaveGameButton({
  gameId,
  busy,
  onLeave,
  label = 'Leave the game',
}: {
  gameId: string;
  busy?: boolean;
  onLeave: () => void;
  label?: string;
}) {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    setConfirm(false);
  }, [gameId]);
  if (confirm) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={onLeave}
        className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-60"
      >
        Sure?
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setConfirm(true)}
      aria-label={label}
      title={label}
      className="rounded-lg p-2.5 hover:bg-stone-500/10"
    >
      <LogOut className="h-5 w-5" />
    </button>
  );
}
