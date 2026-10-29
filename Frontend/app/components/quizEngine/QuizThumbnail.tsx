import { useState } from 'react';
import { QuizSVG } from '~/constants';
import css from './quizThumbnail.module.css';

export default function QuizThumbnail({ src, size = 'item' }: { src?: string | null; size?: 'item' | 'heading' | 'preview' | 'cover' }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  if (size === 'cover' && (!src || src === failedSource)) return null;
  return <span className={`${css.thumbnail} ${css[size]}`} aria-hidden="true">
    {src && src !== failedSource ? <img key={src} src={src} alt="" loading={size === 'item' || size === 'cover' ? 'lazy' : 'eager'} onError={() => setFailedSource(src)} /> : QuizSVG}
  </span>;
}
