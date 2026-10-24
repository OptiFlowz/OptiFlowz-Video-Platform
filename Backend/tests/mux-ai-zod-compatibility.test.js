import assert from 'node:assert/strict';
import { mock, test } from 'node:test';
import { MockLanguageModelV3 } from 'ai/test';

// package.json overrides Zod to >=4.6.7 for GHSA-mrhx-c7xc-m3w5.
// @mux/ai still declares Zod 3, so exercise its real schema consumers here
// whenever updating either dependency instead of relying on a clean audit alone.
const chapters = [{ startTime: 0, title: 'Introduction' }, { startTime: 30, title: 'Example' }];
const model = new MockLanguageModelV3({
  doGenerate: {
    content: [{ type: 'text', text: JSON.stringify({ chapters }) }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: { inputTokens: { total: 20 }, outputTokens: { total: 10 } },
    warnings: [],
  },
});

// Keep real Mux AI workflows and AI SDK structured-output parsing. Only external
// providers are replaced, so these tests need no credentials or network access.
mock.module('@ai-sdk/openai', { namedExports: { createOpenAI: () => () => model } });
const sdk = await import('@mux/ai/workflows');

test('Mux AI schemas still validate, strip extra fields and expose keys with Zod 4', () => {
  assert.deepEqual(sdk.chaptersSchema.parse({ chapters, extra: true }), { chapters });
  assert.equal(sdk.chaptersSchema.safeParse({ chapters: [{ startTime: 'zero', title: 'Intro' }] }).success, false);
  assert.equal(sdk.chapterSchema.safeParse({ startTime: 0, title: 'x'.repeat(301) }).success, false);
  assert.deepEqual(sdk.chapterSchema.keyof().options, ['startTime', 'title']);
  assert.deepEqual(sdk.summarySchema.parse({ title: 'Summary', description: 'Description', keywords: ['test'] }),
    { title: 'Summary', description: 'Description', keywords: ['test'] });
});

test('real chapter workflow converts the overridden schema and parses structured model output', async t => {
  t.mock.method(globalThis, 'fetch', async input => {
    if (String(input) === 'https://api.mux.com/video/v1/assets/test-asset') {
      return Response.json({ data: {
        id: 'test-asset', duration: 60, playback_ids: [{ id: 'test-playback', policy: 'public' }],
        tracks: [{ type: 'video', duration: 60 },
          { type: 'text', text_type: 'subtitles', id: 'test-track', status: 'ready', language_code: 'en' }],
      } });
    }
    assert.equal(String(input), 'https://stream.mux.com/test-playback/text/test-track.vtt');
    return new Response('WEBVTT\n\n00:00:00.000 --> 00:00:29.000\nIntroduction to the course.\n\n00:00:30.000 --> 00:01:00.000\nA practical example.\n');
  });
  const result = await sdk.generateChapters('test-asset', {
    languageCode: 'en', provider: 'openai',
    credentials: { muxTokenId: 'test-id', muxTokenSecret: 'test-secret', openaiApiKey: 'test-key' },
  });
  assert.deepEqual(result.chapters, chapters);
  assert.equal(model.doGenerateCalls.length, 1);
  const schema = model.doGenerateCalls[0].responseFormat.schema;
  assert.equal(schema.properties.chapters.type, 'array');
  assert.equal(schema.properties.chapters.items.properties.startTime.type, 'number');
  assert.equal(schema.properties.chapters.items.properties.title.type, 'string');
});
