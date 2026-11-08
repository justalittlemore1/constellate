import { Pause, Play } from 'lucide-react';
import { useState } from 'react';
import { useApi } from '../../lib/api';
import { playMoment, stopPlayback, usePlayback } from '../../lib/audio';
import { spokenClock } from '../../lib/format';
import { IconButton, useToast } from '../../ui';

export interface PlayMomentButtonProps {
  /** unique per moment (e.g. node id) */
  momentKey: string;
  audioPath: string | null;
  atMs: number;
  /** what is being played, for the accessible name */
  label: string;
}

/** Plays the recording from 1 s before `atMs`; toggles to pause. `aria-pressed` while playing. */
export function PlayMomentButton({ momentKey, audioPath, atMs, label }: PlayMomentButtonProps) {
  const api = useApi();
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
      const url = await api.audioUrl(audioPath);
      if (!url) {
        toast('No recording is available for this conversation.', 'error');
        return;
      }
      await playMoment(momentKey, url, atMs);
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
