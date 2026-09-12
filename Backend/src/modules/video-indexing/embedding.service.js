import { MODEL, DIMENSIONS } from './documents.js';

export async function embedTexts(texts, signal) {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      dimensions: DIMENSIONS,
      input: texts,
      encoding_format: 'float',
    }),
    signal: AbortSignal.any([signal, AbortSignal.timeout(45000)]),
  });
  if (!response.ok) throw new Error(`Embedding API failed (${response.status})`);
  const result = await response.json();
  const vectors = [...(result.data || [])].sort((a, b) => a.index - b.index);
  if (
    vectors.length !== texts.length ||
    vectors.some(
      (v, i) =>
        v.index !== i ||
        !Array.isArray(v.embedding) ||
        v.embedding.length !== DIMENSIONS ||
        v.embedding.some((n) => !Number.isFinite(n)),
    )
  )
    throw new Error('Invalid embedding response');
  return vectors.map((v) => v.embedding);
}
