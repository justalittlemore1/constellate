/** Dialogs and banners of the live screen. */
import type { TopicNode } from '@constellate/shared';
import { FileAudio, MicOff, Play, RotateCcw } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { PARK_MAX_CHARS, type LiveSnapshot } from './controller';

const surface = 'border border-[var(--border)] bg-[var(--surface)] backdrop-blur-[16px]';
const primaryBtn =
  'flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-topic px-5 font-semibold text-bg disabled:opacity-50';
const secondaryBtn =
  'flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-white/20 px-5 font-semibold text-ink';

function Sheet({ labelledBy, children, testId }: { labelledBy: string; children: ReactNode; testId?: string }) {
  return (
    <div className="absolute inset-0 z-30 flex items-end bg-black/50">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        data-testid={testId}
        className={`${surface} w-full rounded-t-[var(--radius)] px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-5`}
      >
        {children}
      </section>
    </div>
  );
}

export function ConsentSheet({ demo, onAgree, onCancel }: { demo: boolean; onAgree(): void; onCancel(): void }) {
  const id = useId();
  const agree = useRef<HTMLButtonElement>(null);
  useEffect(() => agree.current?.focus(), []);
  return (
    <Sheet labelledBy={id} testId="consent-sheet">
      <h2 id={id} className="text-xl font-semibold">
        {demo ? 'Play the demo conversation' : 'Before we start'}
      </h2>
      {demo ? (
        <p className="mt-2 text-[15px] text-ink-2">
          This replays a recorded conversation through the live pipeline. Your microphone stays off.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[15px]">Everyone in this conversation agrees to be recorded.</p>
          <p className="mt-2 text-[13px] text-ink-2">
            Speech is sent to Google (transcription) and Anthropic (topic analysis) to build the map. The recording and
            map stay private to your account. You can stop at any time.
          </p>
        </>
      )}
      <p className="mt-3 text-[13px] text-ink-2">
        Flag a moment with the Flag button, a double-press of F or Space, or your headphones&rsquo; next-track button.
      </p>
      <div className="mt-5 flex flex-col gap-2">
        <button ref={agree} type="button" className={primaryBtn} onClick={onAgree}>
          {demo ? 'Start the demo' : 'Everyone agrees — start'}
        </button>
        <button type="button" className={secondaryBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Sheet>
  );
}

export function ParkSheet({ onPark, onClose }: { onPark(text: string): void; onClose(): void }) {
  const id = useId();
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => input.current?.focus(), []);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onPark(text);
  };
  return (
    <Sheet labelledBy={id} testId="park-sheet">
      <form onSubmit={submit} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <h2 id={id} className="text-xl font-semibold">
          Park a thought
        </h2>
        <label htmlFor={`${id}-text`} className="mt-2 block text-[13px] text-ink-2">
          Something to come back to — two words is enough.
        </label>
        <input
          ref={input}
          id={`${id}-text`}
          value={text}
          maxLength={PARK_MAX_CHARS}
          onChange={(e) => setText(e.target.value)}
          placeholder="e.g. Lisbon trip"
          autoComplete="off"
          className="mt-2 min-h-[44px] w-full rounded-xl border border-white/20 bg-black/30 px-3 text-[15px] text-ink placeholder:text-ink-2/70"
        />
        <p className="mt-1 text-right text-[11.5px] tabular-nums text-ink-2" aria-live="polite">
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
    </Sheet>
  );
}

function statusLine(s: LiveSnapshot): string {
  if (s.phase === 'stopping') return 'Saving the conversation…';
  if (s.upload === 'uploading') return 'Uploading the recording…';
  if (s.upload === 'failed') return 'The recording could not be uploaded, but the map is saved.';
  return 'Saved.';
}

export function BeforeYouGo({
  snapshot,
  threads,
  onOpenMap,
}: {
  snapshot: LiveSnapshot;
  threads: TopicNode[];
  onOpenMap(): void;
}) {
  const id = useId();
  const done = snapshot.phase === 'stopped';
  return (
    <Sheet labelledBy={id} testId="before-you-go">
      <h2 id={id} className="text-xl font-semibold">
        Before you go
      </h2>
      {threads.length > 0 ? (
        <>
          <p className="mt-2 text-[15px]">
            {threads.length === 1 ? 'One thread is' : `${threads.length} threads are`} still open. Close the loop while
            you&rsquo;re together:
          </p>
          <ul className="mt-3 flex max-h-56 flex-col gap-2 overflow-y-auto" aria-label="Open threads">
            {threads.map((n) => (
              <li key={n.id} className="flex items-baseline gap-2 rounded-xl border border-thread/40 px-3 py-2">
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
        <p className="mt-2 text-[15px]">No loose ends — every thread was picked up.</p>
      )}
      <p className="mt-3 text-[13px] text-ink-2" role="status">
        {statusLine(snapshot)}
      </p>
      <button type="button" className={`${primaryBtn} mt-4 w-full`} disabled={!done} onClick={onOpenMap}>
        Open the map
      </button>
    </Sheet>
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
