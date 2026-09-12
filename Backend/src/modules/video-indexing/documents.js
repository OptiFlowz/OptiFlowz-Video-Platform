import { createHash } from 'node:crypto';

export const MODEL = 'text-embedding-3-small';
export const DIMENSIONS = 1536;
export const INDEX_VERSION = 1;
// UTF-8 bytes conservatively bound tokens, including non-English text.
const MAX_BYTES = 6000;
export const contentHash = (text) =>
  createHash('sha256')
    .update(JSON.stringify([MODEL, DIMENSIONS, INDEX_VERSION, text]))
    .digest('hex');

function bounded(text, max = MAX_BYTES) {
  let result = '';
  let bytes = 0;
  for (const char of text) {
    bytes += Buffer.byteLength(char);
    if (bytes > max) break;
    result += char;
  }
  return result;
}

export function overviewDocuments(video) {
  const chapters = Array.isArray(video.chapters) ? video.chapters : [];
  const text = [
    video.title && `Title: ${bounded(String(video.title), 800)}`,
    video.description && `Description: ${bounded(String(video.description), 3000)}`,
    video.tags?.length && `Tags: ${bounded(video.tags.join(', '), 700)}`,
    chapters.length &&
      `Chapters: ${bounded(chapters.map((c) => `${c.startTime}: ${c.title}`).join('\n'), 1300)}`,
  ]
    .filter(Boolean)
    .join('\n');
  return text ? [{ text, start_seconds: null, end_seconds: null }] : [];
}

function seconds(value) {
  const parts = value.split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

export function transcriptDocuments(vtt) {
  if (
    !vtt
      .replace(/^\uFEFF/, '')
      .trimStart()
      .startsWith('WEBVTT')
  )
    throw new Error('Invalid WebVTT header');
  const cues = [];
  for (const block of vtt.replace(/\r\n?/g, '\n').split(/\n\s*\n/)) {
    if (/^(NOTE|STYLE|REGION)(\s|$)/.test(block.trim())) continue;
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const match = lines[i].match(
      /^\s*((?:\d+:)?\d{2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{2}:\d{2}\.\d{3})/,
    );
    if (!match) throw new Error('Invalid WebVTT timestamp');
    const start = seconds(match[1]),
      end = seconds(match[2]);
    if (!Number.isFinite(end) || end <= start) throw new Error('Invalid WebVTT cue range');
    const text = lines
      .slice(i + 1)
      .join(' ')
      .replace(/<[^>]*>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    let remainder = text;
    while (remainder) {
      const part = bounded(remainder, 3000);
      cues.push({ text: part, start_seconds: start, end_seconds: end });
      remainder = remainder.slice(part.length);
    }
  }
  cues.sort((a, b) => a.start_seconds - b.start_seconds);
  const documents = [];
  let current = null;
  for (const cue of cues) {
    if (
      current &&
      (Buffer.byteLength(current.text + ' ' + cue.text) > MAX_BYTES ||
        cue.end_seconds - current.start_seconds > 90)
    ) {
      documents.push(current);
      current = null;
    }
    if (!current) current = { ...cue };
    else {
      current.text += ' ' + cue.text;
      current.end_seconds = Math.max(current.end_seconds, cue.end_seconds);
    }
  }
  if (current) documents.push(current);
  return documents;
}
