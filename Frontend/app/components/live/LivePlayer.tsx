import MuxPlayer from '@mux/mux-player-react';
import type MuxPlayerElement from '@mux/mux-player';
import { forwardRef, useCallback, useEffect, useState, type ComponentProps } from 'react';
import { createPortal } from 'react-dom';
import { LiveSVG } from '~/constants';
import LiveTimeDisplay from './LiveTimeDisplay';
import { useI18n } from '~/i18n';
import { loadMediaTheme, styleMuxPlayerCaptions } from '../playPage/playerCollection/loadMediaTheme';
import { setupMobilePlayerSettings } from '../playPage/playerCollection/mobilePlayerSettings';
import { PlaybackFeedback } from '../playback/playbackFeedback';

type Props = Omit<ComponentProps<typeof MuxPlayer>, 'theme' | 'themeProps'> & {
  title: string;
  dvr: boolean;
  compact?: boolean;
  startedAt?: string | null;
};

// Both the watch page and studio use the same controls as recorded videos.
const LivePlayer = forwardRef<MuxPlayerElement, Props>(function LivePlayer(
  { title, dvr, compact = false, startedAt, onLoadedMetadata, ...props }, forwardedRef,
) {
  const { t } = useI18n();
  const [ready, setReady] = useState(false);
  const [themeError, setThemeError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [element, setElement] = useState<MuxPlayerElement | null>(null);
  const [iconTarget, setIconTarget] = useState<HTMLElement | null>(null);
  const [timeTarget, setTimeTarget] = useState<HTMLElement | null>(null);
  const settingsLabel = t('settings');
  const closeLabel = t('close');
  const setPlayer = useCallback((player: MuxPlayerElement | null) => {
    setElement(player);
    if (typeof forwardedRef === 'function') forwardedRef(player);
    else if (forwardedRef) forwardedRef.current = player;
  }, [forwardedRef]);

  useEffect(() => {
    let cancelled = false;
    setThemeError(false);
    void loadMediaTheme().then(() => {
      if (!cancelled) setReady(true);
    }).catch(() => { if (!cancelled) setThemeError(true); });
    return () => { cancelled = true; };
  }, [attempt]);

  useEffect(() => {
    if (!element) return;
    let cleanup = () => {};
    const frame = requestAnimationFrame(() => {
      const root = element.shadowRoot?.querySelector('media-theme')?.shadowRoot;
      setIconTarget(root?.querySelector<HTMLElement>('#live-indicator-icon') ?? null);
      setTimeTarget(root?.querySelector<HTMLElement>('#live-time-display') ?? null);
      styleMuxPlayerCaptions(element);
      cleanup = setupMobilePlayerSettings(element, { settings: settingsLabel, close: closeLabel });
    });
    return () => { cancelAnimationFrame(frame); cleanup(); };
  }, [element, settingsLabel, closeLabel]);

  if (!ready) return <PlaybackFeedback error={themeError} retry={() => setAttempt(value => value + 1)} />;

  return <>
    <MuxPlayer {...props} ref={setPlayer} preferPlayback="mse"
      theme="optiflowz-theme"
      themeProps={{ videotitlee: title, chapterLenght: 0, compact, livestream: true, dvr, streamtype: 'live' }}
      onLoadedMetadata={event => { styleMuxPlayerCaptions(element); onLoadedMetadata?.(event); }}
    />
    {element && iconTarget && createPortal(LiveSVG, iconTarget)}
    {element && timeTarget && createPortal(<LiveTimeDisplay player={element} startedAt={startedAt} dvr={dvr}/>, timeTarget)}
  </>;
});

export default LivePlayer;
