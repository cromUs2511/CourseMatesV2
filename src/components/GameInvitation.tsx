import { Gamepad2 } from 'lucide-react';

export function GameInvitation({
  game,
  sender,
  incoming,
  busy,
  onRespond,
}: {
  game: string;
  sender: string;
  incoming: boolean;
  busy?: boolean;
  onRespond: (accept: boolean) => void;
}) {
  return (
    <section
      aria-label={`${game} invitation`}
      className="mx-auto w-full max-w-3xl rounded-2xl border border-stone-200 bg-white/95 px-4 py-3 shadow-[0_8px_24px_rgba(41,37,36,0.08)] dark:border-stone-700 dark:bg-stone-900/95"
      style={{ borderLeft: '4px solid var(--chat-accent)' }}
    >
      <div className="flex items-start gap-3">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--chat-accent) 12%, transparent)',
            color: 'var(--chat-accent)',
          }}
        >
          <Gamepad2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-stone-500 dark:text-stone-400">
            Game invitation · 1v1{incoming ? ' · Action needed' : ''}
          </p>
          <h3 className="mt-1 text-sm font-bold text-stone-900 dark:text-white">{game}</h3>
          <p className="mt-1 text-sm leading-relaxed text-stone-600 dark:text-stone-300">
            {incoming
              ? `${sender} invited you to play ${game}. Accept to start near this message.`
              : `Invitation sent to ${sender}. Waiting for them to accept…`}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {incoming && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onRespond(true)}
                className="chat-theme-accent-button min-h-11 flex-1 rounded-xl px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50 sm:flex-none sm:px-6"
              >
                Accept
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() => onRespond(false)}
              className="chat-theme-accent-soft min-h-11 flex-1 rounded-xl border px-4 py-2.5 text-sm font-bold disabled:opacity-50 sm:flex-none sm:px-6"
            >
              {incoming ? 'Decline' : 'Cancel invitation'}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
