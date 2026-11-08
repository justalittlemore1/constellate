import { useMemo } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { env } from '../../lib/env';
import type { LiveSourceSpec } from './controller';
import { DEMO_FIXTURE, LiveScreen } from './LiveScreen';

/**
 * Route element for `/live/:id` (A4: `<Route path="/live/:id" element={<LiveRoute />} />`).
 *   /live/new                         microphone
 *   /live/demo?fixture=<id>           transcript replay on the server (default demo-religion)
 *   ?speed=4                          mock mode only: replay four times faster
 * In mock mode (VITE_USE_MOCKS=1) every route runs the recorded demo op stream.
 */
export function LiveRoute() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const fixture = params.get('fixture') || DEMO_FIXTURE;
  const speed = Number(params.get('speed')) || 1;
  const source = useMemo<LiveSourceSpec>(
    () => (env.useMocks || id === 'demo' ? { kind: 'transcript', fixture } : { kind: 'mic' }),
    [id, fixture],
  );
  return (
    <LiveScreen
      initialSource={source}
      speed={speed}
      onDone={(conversationId) => navigate(`/c/${conversationId}`, { replace: true })}
      onCancel={() => navigate('/', { replace: true })}
    />
  );
}
