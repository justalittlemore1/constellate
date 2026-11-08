import { useEffect, useState, useSyncExternalStore } from 'react';
import { LiveController, type LiveDeps, type LiveSnapshot, type LiveSourceSpec } from './controller';
import { defaultDeps } from './deps';

export interface UseLiveSessionOptions {
  /** inject deps (tests); defaults to the real server, or the mock server when VITE_USE_MOCKS=1 */
  deps?: LiveDeps;
  /** mock replay speed (1 or 4) */
  speed?: number;
}

export interface LiveSession extends LiveSnapshot {
  controller: LiveController | null;
}

const noopSubscribe = () => () => undefined;

/**
 * The live session for one recording. `source` must be stable (memoise it): a new source object
 * starts a new session. The controller is created in an effect so StrictMode's double mount
 * cannot leave a disposed controller behind.
 */
export function useLiveSession(source: LiveSourceSpec, opts: UseLiveSessionOptions = {}): LiveSession {
  const { deps: injected, speed } = opts;
  const [controller, setController] = useState<LiveController | null>(null);

  useEffect(() => {
    const wiring = injected ? { deps: injected, dispose: () => undefined } : defaultDeps({ speed });
    const c = new LiveController(source, wiring.deps);
    setController(c);
    return () => {
      c.dispose();
      wiring.dispose();
    };
  }, [source, injected, speed]);

  const snap = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.getSnapshot ?? (() => idleSnapshot(source)),
  );
  return { ...snap, controller };
}

const idleCache = new WeakMap<LiveSourceSpec, LiveSnapshot>();

/** stable placeholder snapshot until the controller exists */
function idleSnapshot(source: LiveSourceSpec): LiveSnapshot {
  let s = idleCache.get(source);
  if (!s) {
    s = {
      phase: 'idle',
      source,
      conversationId: null,
      graph: null,
      captions: [],
      interim: null,
      stage: null,
      reconnecting: false,
      error: null,
      notice: null,
      upload: 'none',
    };
    idleCache.set(source, s);
  }
  return s;
}
