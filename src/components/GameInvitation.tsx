import { Gamepad2 } from 'lucide-react';

export function GameInvitation({ game, sender, incoming, busy, onRespond }: {
  game: string;
  sender: string;
  incoming: boolean;
  busy?: boolean;
  onRespond: (accept: boolean) => void;
}) {
  return (
    <section aria-label={`${game} invitation`} className="mx-auto my-3 max-w-3xl border-l-4 border-[var(--chat-accent)] bg-stone-100 px-4 py-3 dark:bg-stone-900">
      <div className="flex items-start gap-3">
        <Gamepad2 className="mt-1 h-6 w-6 shrink-0 text-[var(--chat-accent)]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-stone-800 dark:text-stone-100">Game invitation · 1v1</p>
          <h3 className="mt-1 font-bold">{game}</h3>
          <p className="mt-1 text-sm text-stone-600 dark:text-stone-300">
            {incoming ? `${sender} invited you to play ${game}.` : `Invitation sent to ${sender}. Waiting for them to accept…`}
          </p>
          <div className="mt-3 flex gap-2">
            {incoming && <button type="button" disabled={busy} onClick={() => onRespond(true)} className="rounded-lg bg-[var(--chat-accent)] px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Accept</button>}
            <button type="button" disabled={busy} onClick={() => onRespond(false)} className="rounded-lg border border-stone-400 px-4 py-2 text-sm font-semibold dark:border-stone-600 disabled:opacity-50">{incoming ? 'Decline' : 'Cancel invitation'}</button>
          </div>
        </div>
      </div>
    </section>
  );
}
