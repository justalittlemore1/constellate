/**
 * The map on the live screen: A3's <ConversationMap> following the newest node (its own
 * "Jump to now" chip appears once the user pans away). The plain node list stays as the fallback:
 *   - low-stimulation mode (Settings) shows the list instead of the canvas
 *   - before the first topic the list's empty state explains what will appear
 *   - if the canvas ever throws, the list takes over so the recording screen never goes blank
 */
import type { GraphState } from '@constellate/shared';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { usePrefs } from '../../lib/prefs';
import { ConversationMap } from '../map';
import { LiveNodeList } from './LiveNodeList';

export function LiveMap({ graph }: { graph: GraphState | null }) {
  const lowStimulation = usePrefs((s) => s.lowStimulation);
  const list = <LiveNodeList graph={graph} />;
  if (lowStimulation || !graph || Object.keys(graph.nodes).length === 0) return list;
  return (
    <MapBoundary fallback={list}>
      <ConversationMap state={graph} followLatest className="h-full" />
    </MapBoundary>
  );
}

/** Falls back to the node list if the canvas throws; the fallback keeps receiving fresh props. */
export class MapBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[live] map failed, showing the list instead', error, info.componentStack);
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}
