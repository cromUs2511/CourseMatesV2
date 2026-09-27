import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { apiRequest } from '../utils/api';

const REPORT_REASONS = [
  ['harassment', 'Harassment or bullying'],
  ['spam', 'Spam or scams'],
  ['sexual', 'Sexual content'],
  ['threats', 'Threats or violence'],
  ['other', 'Other rule violation'],
] as const;
type ReportReason = (typeof REPORT_REASONS)[number][0];

export function SafetyDialog({
  roomId,
  onClose,
  onBlocked,
}: {
  roomId: string;
  onClose: () => void;
  onBlocked: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const [category, setCategory] = useState<ReportReason>('harassment');
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');
  const busyRef = useRef(false);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current!;
    dialog.showModal();
    const cancel = (event: Event) => {
      event.preventDefault();
      if (!busyRef.current) closeRef.current();
    };
    dialog.addEventListener('cancel', cancel);
    return () => {
      dialog.removeEventListener('cancel', cancel);
      dialog.close();
      previous?.focus({ preventScroll: true });
    };
  }, []);

  const submit = async (block: boolean) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError('');
    try {
      if (block) {
        await apiRequest('/api/safety/block', { roomId });
        onBlocked();
      } else {
        await apiRequest('/api/safety/report', { roomId, category });
        setSubmitted(true);
      }
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'This action could not be completed. Please try again.',
      );
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="safety-dialog-title"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-2xl border border-stone-300 bg-[#faf8f5] p-5 text-stone-900 shadow-2xl backdrop:bg-black/65 dark:border-stone-700 dark:bg-[#181716] dark:text-stone-100"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="safety-dialog-title" className="font-semibold">
          Report or block peer
        </h2>
        <button
          type="button"
          disabled={busy}
          onClick={onClose}
          aria-label="Close safety dialog"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-stone-400 disabled:opacity-50"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <p className="text-sm">
        Reports send the reason and session identifiers to moderators. Message text, photos, and
        recordings are not attached.
      </p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
      {submitted ? (
        <p role="status" className="mt-4 text-sm font-semibold">
          Report submitted for moderator review.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit(false);
          }}
          className="mt-4 space-y-3"
        >
          <label className="block text-sm font-medium" htmlFor="report-category">
            Reason for reporting
          </label>
          <select
            id="report-category"
            value={category}
            disabled={busy}
            onChange={(event) => setCategory(event.target.value as ReportReason)}
            className="w-full rounded-lg border border-stone-400 bg-white p-3 text-stone-900 dark:bg-stone-900 dark:text-stone-100"
          >
            {REPORT_REASONS.map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-lg bg-red-800 px-4 py-3 font-semibold text-white disabled:opacity-50"
          >
            Submit report
          </button>
        </form>
      )}
      <p className="mt-5 text-sm">
        Blocking ends this chat and prevents matching these anonymous sessions again. A new browser
        session can bypass a block.
      </p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void submit(true)}
        className="mt-3 w-full rounded-lg border border-stone-400 px-4 py-3 font-semibold disabled:opacity-50"
      >
        Block peer and end chat
      </button>
      <a
        href="/community"
        target="_blank"
        rel="noopener noreferrer"
        className="mt-4 inline-block text-sm underline"
      >
        Community rules and enforcement
      </a>
    </dialog>
  );
}
