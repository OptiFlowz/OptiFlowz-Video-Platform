import { useEffect, useState } from 'react';
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
  const sentences = t('heroTitle').split('. ').map((sentence, index, all) =>
    index < all.length - 1 && !sentence.endsWith('.') ? `${sentence}.` : sentence);
  const move = (direction: number) => setSelected(index => (index + direction + images.length) % images.length);

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
      {images.map((image, index) => <img key={image} src={image} alt="" draggable={false}
        className={selected === index ? 'isSelected' : undefined} />)}
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
