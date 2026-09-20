import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useI18n } from '~/i18n';
import HeroLarge from '../../../assets/Slider1.webp';
import HeroMedium from '../../../assets/Slider2.webp';
import HeroSmall from '../../../assets/Slider3.webp';
import './homeBanner.css';

const images = [HeroLarge, HeroMedium, HeroSmall];

export default function HomeBanner() {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const [hidden, setHidden] = useState(false);
  const [requested, setRequested] = useState(() => new Set([0]));
  const [loaded, setLoaded] = useState(() => new Set<number>());
  const [visible, setVisible] = useState(0);
  const sentences = t('heroTitle').split('. ').map((sentence, index, all) =>
    index < all.length - 1 && !sentence.endsWith('.') ? `${sentence}.` : sentence);
  const move = (direction: number) => setSelected(index => (index + direction + images.length) % images.length);

  useEffect(() => {
    if (loaded.has(selected)) setVisible(selected);
    if (hidden || !loaded.has(selected)) return;
    // Warm just the next slide after the current image is visible. Keep the
    // previous image on screen if a manually selected slide is still loading.
    const timer = window.setTimeout(() => {
      const next = (selected + 1) % images.length;
      setRequested(current => current.has(next) ? current : new Set([...current, next]));
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [selected, hidden, loaded]);

  useEffect(() => {
    const updateVisibility = () => setHidden(document.hidden);
    updateVisibility();
    document.addEventListener('visibilitychange', updateVisibility);
    return () => document.removeEventListener('visibilitychange', updateVisibility);
  }, []);

  return <section className="homeBanner" aria-label={t('heroTitle')}
    onKeyDown={event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      move(event.key === 'ArrowRight' ? 1 : -1);
    }}>
    <div className="homeBannerArtwork" aria-hidden="true">
      {images.map((image, index) => (requested.has(index) || selected === index || visible === index) &&
        <Image key={image} src={image} alt="" draggable={false} fill
          sizes="(max-width: 540px) 100vw, (max-width: 900px) 80vw, 76vw"
          loading="eager" fetchPriority={index === selected ? 'high' : 'low'}
          onLoad={() => setLoaded(current => current.has(index) ? current : new Set([...current, index]))}
          className={visible === index ? 'isSelected' : undefined} />)}
    </div>
    <div className="homeBannerCopy">
      <h1>{sentences.map((sentence, index) => <span key={index}>{sentence}</span>)}</h1>
    </div>
    <div className="homeBannerNavigation">
      <div className={`homeBannerIndicators${hidden ? ' isPaused' : ''}`}>
        {images.map((_, index) => <button type="button" key={index}
          aria-label={t('settingsHeroSlide', { number: index + 1 })}
          aria-current={selected === index ? 'true' : undefined}
          onClick={() => setSelected(index)}>
          <span className="homeBannerIndicatorTrack">
            {selected === index && <span className="homeBannerIndicatorFill" onAnimationEnd={() => move(1)} />}
          </span>
        </button>)}
      </div>
    </div>
  </section>;
}
