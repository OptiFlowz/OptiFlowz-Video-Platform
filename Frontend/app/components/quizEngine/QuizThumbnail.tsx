import { useState } from 'react';
import { QuizSVG } from '~/constants';
import css from './quizThumbnail.module.css';

export default function QuizThumbnail({ src, size = 'item' }: { src?: string | null; size?: 'item' | 'heading' | 'preview' }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  return <span className={`${css.thumbnail} ${css[size]}`} aria-hidden="true">
    {src && src !== failedSource ? <img key={src} src={src} alt="" loading={size === 'item' ? 'lazy' : 'eager'} onError={() => setFailedSource(src)} /> : QuizSVG}
  </span>;
}
