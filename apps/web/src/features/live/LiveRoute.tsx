import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { env } from '../../lib/env';
import type { LiveDeps, LiveSourceSpec } from './controller';
import { DEMO_FIXTURE, LiveScreen } from './LiveScreen';

/** How fast "Try a demo conversation" replays in mock mode (the second topic arrives after ~18 s). */
export const MOCK_DEMO_SPEED = 4;

/**
 * Route element for `/live/:id` (wired by A4).
 *   /live/new                    microphone — always real time
 *   /live/new?replay=<fixture>   transcript replay (A4's routes.demoLive); /live/demo?fixture=<id> too
 *   ?speed=<n>                   mock mode only: override the replay speed
 * In mock mode (VITE_USE_MOCKS=1) every route runs the recorded demo op stream; demo routes at 4×.
 * Against the real server the replay speed is the server's REPLAY_SPEED; set VITE_DEMO_REPLAY_SPEED
 * to the same value so the timer and the "Demo replay ×N" label match it.
 */
export function liveRouteConfig(
  id: string | undefined,
  params: URLSearchParams,
  opts: { useMocks: boolean; serverDemoSpeed: number },
): { source: LiveSourceSpec; speed: number } {
  const replay = params.get('replay');
  const fixture = replay || params.get('fixture') || DEMO_FIXTURE;
  const demo = id === 'demo' || Boolean(replay);
  const asked = Number(params.get('speed'));
  const speed = opts.useMocks
    ? asked > 0
      ? asked
      : demo
        ? MOCK_DEMO_SPEED
        : 1
    : demo
      ? opts.serverDemoSpeed > 0
        ? opts.serverDemoSpeed
        : 1
      : 1;
  const source: LiveSourceSpec = opts.useMocks || demo ? { kind: 'transcript', fixture } : { kind: 'mic' };
  return { source, speed };
}

/** where a finished recording goes: the saved map with the Diary open, while the reflection is fresh */
export function savedConversationPath(conversationId: string): string {
  return `/c/${encodeURIComponent(conversationId)}?diary=1`;
}

export function LiveRoute({ deps }: { deps?: LiveDeps } = {}) {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const key = params.toString();
  const { source, speed } = useMemo(
    () =>
      liveRouteConfig(id, new URLSearchParams(key), {
        useMocks: env.useMocks,
        serverDemoSpeed: Number(import.meta.env.VITE_DEMO_REPLAY_SPEED) || 1,
      }),
    [id, key],
  );
  return (
    <LiveScreen
      initialSource={source}
      speed={speed}
      deps={deps}
      onDone={(conversationId) => navigate(savedConversationPath(conversationId), { replace: true })}
      onCancel={() => navigate('/', { replace: true })}
    />
  );
}
