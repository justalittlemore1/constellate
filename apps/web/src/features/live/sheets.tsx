/**
 * Dialogs of the live screen. Consent, Before you go and the flag note are A4's <BottomSheet>
 * (attached to the bottom, star-chart frame); Park a thought (hidden by flags.ts) stays on <Sheet>. All are
 * labelled modal dialogs: focus moves in and is trapped, Escape / scrim / Close call onClose, focus
 * returns to the opener.
 */
import type { TopicNode } from '@constellate/shared';
import { FileAudio, MicOff, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { BottomSheet, Sheet } from '../../ui';
import { PARK_MAX_CHARS, type LiveSnapshot } from './controller';
import { FLAG_NOTE_MAX_CHARS } from './flags';
import { SHEET_BUTTON } from './styles';

const primaryBtn =
  'flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-topic px-5 font-semibold text-bg disabled:opacity-50';
const secondaryBtn =
  'flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-white/20 px-5 font-semibold text-ink';

/** Escape, the scrim and Close all mean "Cancel" here. */
export function ConsentSheet({
  open,
  demo,
  onAgree,
  onCancel,
  notes = false,
}: {
  open: boolean;
  demo: boolean;
  onAgree(): void;
  onCancel(): void;
  /** flag notes are on: mention hold / Shift+F */
  notes?: boolean;
}) {
  return (
    <BottomSheet
      open={open}
      onClose={onCancel}
      title={demo ? 'Play the demo conversation' : 'Before we start'}
      testId="consent-sheet"
    >
      {demo ? (
        <p className="mt-1 text-[15px] text-ink-2">
          This replays a recorded conversation through the live pipeline. Your microphone stays off.
        </p>
      ) : (
        <>
          <p className="mt-1 text-[15px]">Everyone in this conversation agrees to be recorded.</p>
          <p className="mt-2 text-[13px] text-ink-2">
            Speech is sent to Google (transcription) and Anthropic (topic analysis) to build the map. The recording and
            map stay private to your account. You can stop at any time.
          </p>
        </>
      )}
      <p className="mt-3 text-[13px] text-ink-2">
        Flag a moment with the Flag button, a double-press of F or Space, or your headphones&rsquo; next-track button.
        {notes && ' Press and hold Flag (or press Shift+F) to add a note.'}
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button data-autofocus type="button" className={SHEET_BUTTON.primary} onClick={onAgree}>
          {demo ? 'Start the demo' : 'Everyone agrees — start'}
        </button>
        <button type="button" className={SHEET_BUTTON.secondary} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}

/**
 * A short note for the flag being added. Save note → flag with the note; Flag without note → the
 * plain flag; Escape / Close / scrim → cancel (nothing is flagged).
 */
export function FlagNoteSheet({
  open,
  onSave,
  onFlagOnly,
  onCancel,
}: {
  open: boolean;
  onSave(note: string): void;
  onFlagOnly(): void;
  onCancel(): void;
}) {
  return (
    <BottomSheet open={open} onClose={onCancel} title="Add a note to this flag" testId="flag-note-sheet">
      <FlagNoteForm onSave={onSave} onFlagOnly={onFlagOnly} />
    </BottomSheet>
  );
}

/** separate component so the text resets every time the sheet opens */
function FlagNoteForm({ onSave, onFlagOnly }: { onSave(note: string): void; onFlagOnly(): void }) {
  const id = useId();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onSave(text);
  };
  return (
    <form onSubmit={submit}>
      <label htmlFor={`${id}-note`} className="block text-[13px] font-semibold">
        Note
      </label>
      <p id={`${id}-help`} className="text-[13px] text-ink-2">
        What made this moment worth flagging? It stays on the topic, with the flag.
      </p>
      <textarea
        data-autofocus
        id={`${id}-note`}
        aria-describedby={`${id}-help ${id}-count`}
        value={text}
        maxLength={FLAG_NOTE_MAX_CHARS}
        rows={3}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // Enter saves, Shift+Enter makes a new line
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (text.trim()) onSave(text);
          }
        }}
        placeholder="e.g. Sam's point about the Q source"
        className="mt-2 w-full resize-none rounded-none border border-[var(--border)] bg-black/30 px-3 py-2 text-[15px] text-ink placeholder:text-ink-2/70"
      />
      <p id={`${id}-count`} className="mt-1 text-right text-[11.5px] tabular-nums text-ink-2">
        {text.length}/{FLAG_NOTE_MAX_CHARS} characters
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={`${SHEET_BUTTON.secondary} flex-1`} onClick={onFlagOnly}>
          Flag without note
        </button>
        <button type="submit" className={`${SHEET_BUTTON.primary} flex-1`} disabled={!text.trim()}>
          Save note
        </button>
      </div>
    </form>
  );
}

export function ParkSheet({ open, onPark, onClose }: { open: boolean; onPark(text: string): void; onClose(): void }) {
  return (
    <Sheet open={open} onClose={onClose} title="Park a thought" testId="park-sheet">
      <ParkForm onPark={onPark} onClose={onClose} />
    </Sheet>
  );
}

/** separate component so the text resets every time the sheet opens */
function ParkForm({ onPark, onClose }: { onPark(text: string): void; onClose(): void }) {
  const id = useId();
  const [text, setText] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) onPark(text);
  };
  return (
    <form onSubmit={submit}>
      <label htmlFor={`${id}-text`} className="mt-1 block text-[13px] text-ink-2">
        Something to come back to — two words is enough.
      </label>
      <input
        data-autofocus
        id={`${id}-text`}
        value={text}
        maxLength={PARK_MAX_CHARS}
        onChange={(e) => setText(e.target.value)}
        placeholder="e.g. Lisbon trip"
        autoComplete="off"
        className="mt-2 min-h-[44px] w-full rounded-xl border border-white/20 bg-black/30 px-3 text-[15px] text-ink placeholder:text-ink-2/70"
      />
      <p className="mt-1 text-right text-[11.5px] tabular-nums text-ink-2" aria-hidden>
        {text.length}/{PARK_MAX_CHARS}
      </p>
      <div className="mt-3 flex gap-2">
        <button type="button" className={`${secondaryBtn} flex-1`} onClick={onClose}>
          Cancel
        </button>
        <button type="submit" className={`${primaryBtn} flex-1`} disabled={!text.trim()}>
          Park it
        </button>
      </div>
    </form>
  );
}

function statusLine(s: LiveSnapshot): string {
  if (s.phase === 'stopping') return 'Saving the conversation…';
  if (s.upload === 'uploading') return 'Uploading the recording…';
  if (s.upload === 'failed') return 'The recording could not be uploaded, but the map is saved.';
  return 'Saved.';
}

/**
 * Shown after Stop. "Open the map" waits until everything is saved; Escape / Close leave at once
 * (saving and the upload carry on in the background).
 */
export function BeforeYouGo({
  open,
  snapshot,
  threads,
  onOpenMap,
  onLeave,
}: {
  open: boolean;
  snapshot: LiveSnapshot;
  threads: TopicNode[];
  onOpenMap(): void;
  onLeave(): void;
}) {
  const done = snapshot.phase === 'stopped';
  return (
    <BottomSheet open={open} onClose={onLeave} title="Before you go" testId="before-you-go">
      {threads.length > 0 ? (
        <>
          <p className="mt-1 text-[15px]">
            {threads.length === 1 ? 'One thread is' : `${threads.length} threads are`} still open. Close the loop while
            you&rsquo;re together:
          </p>
          <ul className="mt-3 flex max-h-56 flex-col gap-2 overflow-y-auto" aria-label="Open threads">
            {threads.map((n) => (
              <li key={n.id} className="flex items-baseline gap-2 rounded-none border border-thread/40 px-3 py-2">
                <span aria-hidden className="text-thread">
                  {n.kind === 'parked' ? '✎' : '◌'}
                </span>
                <span className="font-semibold">{n.label}</span>
                <span className="ml-auto text-[11.5px] text-ink-2">
                  {n.kind === 'parked' ? 'parked by you' : 'mentioned for later'}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-[15px]">No loose ends — every thread was picked up.</p>
      )}
      <p className="mt-3 text-[13px] text-ink-2" role="status">
        {statusLine(snapshot)}
      </p>
      <button type="button" className={`${SHEET_BUTTON.primary} mt-4 w-full`} disabled={!done} onClick={onOpenMap}>
        Open the map
      </button>
    </BottomSheet>
  );
}

export function MicRecovery({
  onRetry,
  onWav,
  onDemo,
  onHome,
  reason,
}: {
  onRetry(): void;
  onWav(data: ArrayBuffer, name: string): void;
  onDemo(): void;
  onHome(): void;
  reason: 'mic-denied' | 'mic-unavailable';
}) {
  const id = useId();
  const file = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <main className="flex h-full flex-col justify-center gap-4 px-6" aria-labelledby={id}>
      <MicOff aria-hidden size={40} className="text-flag" />
      <h1 id={id} ref={heading} tabIndex={-1} className="text-2xl font-semibold">
        {reason === 'mic-denied' ? 'The microphone is blocked' : 'The microphone is not available'}
      </h1>
      <p className="text-[15px] text-ink-2">
        {reason === 'mic-denied'
          ? 'Allow microphone access for this site in your browser’s settings, then try again. Or run the same pipeline from an audio file or the demo conversation.'
          : 'No microphone could be opened. You can still run the pipeline from an audio file or the demo conversation.'}
      </p>
      <div className="flex flex-col gap-2">
        <button type="button" className={primaryBtn} onClick={onRetry}>
          <RotateCcw aria-hidden size={18} /> Try the microphone again
        </button>
        <button type="button" className={secondaryBtn} onClick={() => file.current?.click()}>
          <FileAudio aria-hidden size={18} /> Replay a WAV file
        </button>
        <input
          ref={file}
          type="file"
          accept="audio/wav,audio/x-wav,audio/*"
          aria-label="Choose an audio file to replay"
          className="sr-only"
          tabIndex={-1}
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) onWav(await f.arrayBuffer(), f.name);
          }}
        />
        <button type="button" className={secondaryBtn} onClick={onDemo}>
          <Play aria-hidden size={18} /> Play the demo conversation
        </button>
        <button type="button" className="min-h-[44px] text-ink-2 underline" onClick={onHome}>
          Back to home
        </button>
      </div>
    </main>
  );
}
