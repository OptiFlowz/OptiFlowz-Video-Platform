import { useEffect, useState } from 'react';
import type MuxPlayerElement from '@mux/mux-player';
import { formatDuration } from '~/functions';

export default function LiveTimeDisplay({ player, startedAt, dvr }: {
  player: MuxPlayerElement;
  startedAt?: string | null;
  dvr: boolean;
}) {
  const [time, setTime] = useState({ position: '--:--', elapsed: '--:--' });

  useEffect(() => {
    const start = startedAt ? Date.parse(startedAt) : NaN;
    const update = () => {
      const elapsed = Number.isFinite(start) ? Math.max(0, (Date.now() - start) / 1000) : NaN;
      // Program date/time maps the playing frame to the broadcast's clock.
      // DVR asset playback also has a zero-based recording timeline as fallback.
      const programTime = dvr ? player.currentPdt?.getTime() : undefined;
      const position = Number.isFinite(start) && programTime != null && Number.isFinite(programTime)
        ? (programTime - start) / 1000 : player.currentTime;
      const format = (seconds: number) => Number.isFinite(seconds)
        ? formatDuration(Math.floor(Math.max(0, seconds))) : '--:--';
      const next = {
        position: format(Number.isFinite(elapsed) ? Math.min(position, elapsed) : position),
        elapsed: format(elapsed),
      };
      setTime(previous => previous.position === next.position && previous.elapsed === next.elapsed ? previous : next);
    };
    update();
    const interval = window.setInterval(update, 1000);
    player.addEventListener('timeupdate', update);
    player.addEventListener('seeked', update);
    return () => {
      window.clearInterval(interval);
      player.removeEventListener('timeupdate', update);
      player.removeEventListener('seeked', update);
    };
  }, [player, startedAt, dvr]);

  return <>{dvr ? `${time.position} / ${time.elapsed}` : time.elapsed}</>;
}
