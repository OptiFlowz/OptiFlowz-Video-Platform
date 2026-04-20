import { Profanity } from '@2toad/profanity';
import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from 'obscenity';

const profanity = new Profanity();

const obscenityMatcher = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});

function normalizeText(text) {
  return text
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function moderateText(text) {
  if (typeof text !== 'string') {
    return {
      allowed: false,
      reason: 'invalid text',
    };
  }

  const normalized = normalizeText(text);

  const hasBadWords2toad = profanity.exists(normalized);
  const hasBadWordsObscenity = obscenityMatcher.hasMatch(normalized);

  if (hasBadWords2toad || hasBadWordsObscenity) {
    return {
      allowed: false,
      reason: 'contains blocked words',
    };
  }

  return {
    allowed: true,
  };
}