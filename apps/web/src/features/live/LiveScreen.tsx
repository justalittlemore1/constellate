/**
 * /live/:id — consent sheet, then a full-screen live map with the recording bar, a one-line
 * caption strip, and Flag · Park a thought · Stop. Route wiring belongs to A4 (see LiveRoute).
 */
import type { GraphState, LiveStage } from '@constellate/shared';
import { Flag, Moon, NotebookPen, Square, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useFocusTrap } from '../../ui';
import type { LiveController, LiveDeps, LiveSourceSpec } from './controller';
import { captionTail } from './captions';
import { LiveMap } from './LiveMap';
import { formatClock, openThreads } from './openThreads';
import { BeforeYouGo, ConsentSheet, MicRecovery, ParkSheet } from './sheets';
import { useFlagTrigger } from './useFlagTrigger';
import { useLiveSession } from './useLiveSession';

export const DEMO_FIXTURE = 'demo-religion';
const AUTO_LEAVE_MS = 1500;
const TOAST_MS = 2500;

export interface LiveScreenProps {
  initialSource: LiveSourceSpec;
  /** called with the conversation id when the user is done (A4 navigates to /c/:id) */
  onDone(conversationId: string): void;
  /** leave without recording */
  onCancel(): void;
  /**
   * transcript-replay speed: drives the mock server and the replay timer, and is shown as
   * "Demo replay ×4". Microphone and WAV sources always run on the real audio clock.
   */
  speed?: number;
  /** tests */
  deps?: LiveDeps;
  /** override the map (tests); defaults to <LiveMap>: A3's map, with the node list as fallback */
  renderMap?: (graph: GraphState | null) => ReactNode;
}

const STAGE_TEXT: Record<LiveStage, string> = {
  listening: 'Listening',
  thinking: 'Thinking…',
  'reconnecting-stt': 'Reconnecting speech…',
  finalizing: 'Finishing up…',
};

/** Holds the source so the mic-recovery screen can switch to WAV or transcript replay. */
export function LiveScreen({ initialSource, ...rest }: LiveScreenProps) {
  const [source, setSource] = useState<LiveSourceSpec>(initialSource);
  return <LiveSessionView key={sourceKey(source)} source={source} setSource={setSource} {...rest} />;
}

let keySeq = 0;
const keys = new WeakMap<LiveSourceSpec, number>();
function sourceKey(s: LiveSourceSpec): number {
  if (!keys.has(s)) keys.set(s, ++keySeq);
  return keys.get(s)!;
}

function useClock(controller: LiveController | null, running: boolean): number {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!controller) return;
    setMs(controller.clockMs());
    if (!running) return;
    const t = setInterval(() => setMs(controller.clockMs()), 250);
    return () => clearInterval(t);
  }, [controller, running]);
  return ms;
}

function LiveSessionView({
  source,
  setSource,
  onDone,
  onCancel,
  speed,
  deps,
  renderMap,
}: Omit<LiveScreenProps, 'initialSource'> & { source: LiveSourceSpec; setSource(s: LiveSourceSpec): void }) {
  const s = useLiveSession(source, { deps, speed });
  const { controller, phase } = s;
  const [parking, setParking] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const toastSeq = useRef(0);

  const show = useCallback((text: string) => setToast({ id: ++toastSeq.current, text }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), TOAST_MS);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (s.notice) show(s.notice.message);
  }, [s.notice, show]);

  useEffect(() => {
    if (phase === 'idle') controller?.requestConsent();
  }, [phase, controller]);

  const live = phase === 'live';
  const recording = phase === 'live' || phase === 'connecting';
  const clockMs = useClock(controller, recording);

  const trigger = useFlagTrigger(
    useCallback(
      (src) => {
        const ok = controller?.flag(src) ?? false;
        if (ok) show('Moment flagged');
        return ok;
      },
      [controller, show],
    ),
    { enabled: live && !parking },
  );

  const threads = useMemo(() => openThreads(s.graph), [s.graph]);
  const ending = phase === 'stopping' || phase === 'stopped';
  const conversationId = s.conversationId;

  /** to the saved map, or home if the server never assigned a conversation */
  const leave = useCallback(() => {
    if (conversationId) onDone(conversationId);
    else onCancel();
  }, [conversationId, onDone, onCancel]);

  // nothing left open: go straight to the saved map once everything is stored
  useEffect(() => {
    if (phase !== 'stopped' || threads.length > 0) return;
    const t = setTimeout(leave, conversationId ? AUTO_LEAVE_MS : 0);
    return () => clearTimeout(t);
  }, [phase, threads.length, conversationId, leave]);

  const pocketPanel = useRef<HTMLDivElement>(null);
  useFocusTrap(pocketPanel, trigger.pocket, () => trigger.setPocket(false));

  if (phase === 'error' && (s.error?.code === 'mic-denied' || s.error?.code === 'mic-unavailable')) {
    return (
      <MicRecovery
        reason={s.error.code}
        onRetry={() => setSource({ kind: 'mic' })}
        onWav={(data, name) => setSource({ kind: 'wav', data, name })}
        onDemo={() => setSource({ kind: 'transcript', fixture: DEMO_FIXTURE })}
        onHome={onCancel}
      />
    );
  }

  if (phase === 'error') {
    return (
      <main className="flex h-full flex-col justify-center gap-4 px-6">
        <h1 className="text-2xl font-semibold">The recording stopped</h1>
        <p className="text-[15px] text-ink-2" role="alert">
          {s.error?.message ?? 'Something went wrong.'}
        </p>
        {conversationId && (
          <button
            type="button"
            className="min-h-[44px] rounded-full bg-topic px-5 font-semibold text-bg"
            onClick={() => onDone(conversationId)}
          >
            Open what was saved
          </button>
        )}
        <button
          type="button"
          className="min-h-[44px] rounded-full border border-white/20 px-5 font-semibold"
          onClick={() => setSource({ ...source })}
        >
          Start again
        </button>
        <button type="button" className="min-h-[44px] text-ink-2 underline" onClick={onCancel}>
          Back to home
        </button>
      </main>
    );
  }

  const stageText = ending
    ? phase === 'stopping'
      ? 'Saving…'
      : 'Saved'
    : s.reconnecting
      ? 'Reconnecting…'
      : phase === 'connecting'
        ? 'Connecting…'
        : s.stage
          ? STAGE_TEXT[s.stage]
          : '';
  const lastCaption = s.captions.at(-1)?.text ?? '';
  const caption = captionTail(lastCaption, s.interim);
  const sourceLabel =
    source.kind === 'transcript'
      ? speed && speed > 1
        ? `Demo replay ×${speed}`
        : 'Demo replay'
      : source.kind === 'wav'
        ? `Replaying ${source.name ?? 'audio file'}`
        : null;

  // opened only once the session reaches 'consenting' (an effect after mount): on the very first render
  // the PhoneFrame's #overlay-root does not exist yet, and a sheet portalled then would move containers
  // on the next render and lose its initial focus
  const consenting = phase === 'consenting';
  const overlayOpen = consenting || phase === 'idle' || parking || ending || trigger.pocket;

  return (
    <div className="relative h-full" data-testid="live-screen">
      <p className="sr-only" role="status">
        {s.reconnecting ? 'Connection lost. Reconnecting…' : ''}
      </p>
      <main aria-label="Live conversation" className="flex h-full flex-col" inert={overlayOpen} data-testid="live-content">
      {/* top bar: elapsed time on the audio clock, recording indicator (dot + word), stage */}
      <header className="flex min-h-[56px] items-center gap-3 border-b border-white/10 px-4">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <span
            aria-hidden
            className={`inline-block size-2.5 rounded-full ${recording ? 'bg-[#ff4d5e] motion-safe:animate-pulse' : 'bg-ink-2'}`}
          />
          {recording ? 'Recording' : ending ? 'Stopped' : 'Ready'}
        </span>
        <span role="timer" aria-label="Elapsed time" className="tabular-nums text-[15px] font-semibold">
          {formatClock(clockMs)}
        </span>
        <span className="flex min-w-0 flex-1 items-center justify-end gap-1.5 truncate text-[13px] text-ink-2">
          {s.reconnecting && <WifiOff aria-hidden size={14} />}
          {stageText}
        </span>
        <button
          type="button"
          aria-label="Pocket mode: dim the screen, double-tap anywhere to flag"
          disabled={!live}
          onClick={() => trigger.setPocket(true)}
          className="flex size-11 items-center justify-center rounded-full text-ink-2 disabled:opacity-40"
        >
          <Moon aria-hidden size={20} />
        </button>
      </header>
      {sourceLabel && <p className="px-4 pt-1 text-[11.5px] text-ink-2">{sourceLabel}</p>}

      {/* one-line caption strip; finals are announced, interim text is dimmed */}
      <div className="flex min-h-[44px] items-center gap-1 overflow-hidden border-b border-white/10 px-4 text-[15px]" data-testid="captions">
        <p className="sr-only" aria-live="polite">
          {lastCaption}
        </p>
        <p
          aria-hidden
          data-testid="caption-line"
          className="flex min-w-0 flex-1 justify-end overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,transparent,black_1.5rem)]"
        >
          {caption.cut && <span className="mr-1 shrink-0 text-ink-2">…</span>}
          {caption.final && <span className="shrink-0">{caption.final}</span>}
          {caption.interim && <span className="ml-1 shrink-0 text-ink-2/70 italic">{caption.interim}</span>}
          {!lastCaption && !s.interim && <span className="text-ink-2">Captions appear here.</span>}
        </p>
      </div>

      <div className="min-h-0 flex-1">{renderMap ? renderMap(s.graph) : <LiveMap graph={s.graph} />}</div>

      {/* bottom bar */}
      <nav aria-label="Recording controls" className="grid grid-cols-3 gap-2 border-t border-white/10 px-3 pb-[max(12px,env(safe-area-inset-bottom))] pt-3">
        <button
          type="button"
          disabled={!live}
          onClick={() => trigger.flag('button')}
          aria-describedby="flag-hint"
          className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-flag/15 font-semibold text-flag disabled:opacity-40"
        >
          <Flag aria-hidden size={22} />
          Flag
        </button>
        <span id="flag-hint" className="sr-only">
          Also: double-press F or Space, or a media key.
        </span>
        <button
          type="button"
          disabled={!live}
          onClick={() => setParking(true)}
          className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-thread/15 text-[13px] font-semibold text-thread disabled:opacity-40"
        >
          <NotebookPen aria-hidden size={22} />
          Park a thought
        </button>
        <button
          type="button"
          disabled={!recording}
          onClick={() => void controller?.stop()}
          className="flex min-h-[56px] flex-col items-center justify-center gap-0.5 rounded-2xl bg-white/10 font-semibold text-ink disabled:opacity-40"
        >
          <Square aria-hidden size={20} fill="currentColor" />
          Stop
        </button>
      </nav>
      </main>

      {toast && (
        <div
          key={toast.id}
          role="status"
          className="pointer-events-none absolute inset-x-0 bottom-28 z-20 mx-auto w-fit rounded-full bg-black/80 px-4 py-2 text-[13px] font-semibold"
        >
          {toast.text}
        </div>
      )}

      <ConsentSheet
        open={consenting}
        demo={source.kind === 'transcript'}
        onAgree={() => void controller?.consent()}
        onCancel={onCancel}
      />

      <ParkSheet
        open={parking}
        onClose={() => setParking(false)}
        onPark={(text) => {
          if (controller?.park(text)) show(`Parked: ${text.trim().slice(0, 40)}`);
          setParking(false);
        }}
      />

      <BeforeYouGo open={ending} snapshot={s} threads={threads} onOpenMap={leave} onLeave={leave} />

      {trigger.pocket && (
        <div
          ref={pocketPanel}
          role="dialog"
          aria-modal="true"
          aria-label="Pocket mode"
          tabIndex={-1}
          data-testid="pocket-mode"
          onPointerUp={trigger.onPocketTap}
          className="absolute inset-0 z-40 flex touch-manipulation select-none flex-col items-center justify-center gap-6 bg-black/95 px-8 text-center outline-none"
        >
          <p className="text-[15px] text-ink-2">
            Pocket mode. Double-tap anywhere to flag a moment. Escape or the button below exits.
            <br />
            <span className="tabular-nums">{formatClock(clockMs)}</span>
          </p>
          <button
            data-autofocus
            type="button"
            onPointerUp={(e) => e.stopPropagation()}
            onClick={() => trigger.setPocket(false)}
            className="min-h-[44px] rounded-full border border-white/20 px-5 text-[13px] font-semibold text-ink-2"
          >
            Exit pocket mode
          </button>
        </div>
      )}
    </div>
  );
}
