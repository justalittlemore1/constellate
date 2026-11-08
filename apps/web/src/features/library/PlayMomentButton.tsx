import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import type { Utterance } from '@constellate/shared';
import { stopPlayback, usePlayback, usePlayMoment } from '../../lib/audio';
import { spokenClock } from '../../lib/format';
import { IconButton, useToast } from '../../ui';

export interface PlayMomentButtonProps {
  /** unique per moment (e.g. node id) */
  momentKey: string;
  conversationId: string;
  audioPath: string | null;
  atMs: number;
  /** end of the moment (a node's endMs); null plays a default-length clip */
  endMs?: number | null;
  /** pass when known; otherwise fetched for the transcript fallback */
  utterances?: Utterance[];
  /** what is being played, for the accessible name */
  label: string;
}

/**
 * Plays the moment from 1 s before `atMs`: the recording when there is one, otherwise its
 * transcript as timed captions in the now-playing bar. Toggles to stop; `aria-pressed` while playing.
 */
export function PlayMomentButton({
  momentKey,
  conversationId,
  audioPath,
  atMs,
  endMs = null,
  utterances,
  label,
}: PlayMomentButtonProps) {
  const play = usePlayMoment();
  const toast = useToast();
  const { isPlaying } = usePlayback();
  const [loading, setLoading] = useState(false);
  const playing = isPlaying(momentKey);

  async function toggle() {
    if (playing) {
      stopPlayback();
      return;
    }
    setLoading(true);
    try {
      await play({ key: momentKey, conversationId, startMs: atMs, endMs, audioPath, utterances });
    } catch {
      toast('Couldn’t play the recording.', 'error');
    } finally {
      setLoading(false);
    }
  }

  return (
    <IconButton
      label={`${playing ? 'Pause' : 'Play'} ${label} at ${spokenClock(atMs)}`}
      aria-pressed={playing}
      disabled={loading}
      onClick={toggle}
      className="border border-topic/40 text-topic"
    >
      {playing ? <Pause aria-hidden size={18} /> : <Play aria-hidden size={18} />}
    </IconButton>
  );
}
