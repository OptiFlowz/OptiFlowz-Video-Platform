import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createCollectionSchema, requireCollectionUser, listCollectionsSchema, updateCollectionSchema,
  addCollectionPlaylistsSchema, reorderCollectionPlaylistsSchema,
} from '../src/modules/collections/helpers/collections.validation.js';

test('collection creation normalizes text and accepts optional or null descriptions', () => {
  assert.deepEqual(createCollectionSchema.parse({ title: ' Collection ' }), {
    title: 'Collection', description: null, subheading: null, visibility: 'public',
  });
  assert.deepEqual(createCollectionSchema.parse({ title: 'Collection', description: ' Description ' }), {
    title: 'Collection', description: 'Description', subheading: null, visibility: 'public',
  });
  assert.equal(createCollectionSchema.parse({ title: 'x'.repeat(255), description: null }).description, null);
});

test('collection visibility and subheading validate on create, update and listing', () => {
  assert.deepEqual(createCollectionSchema.parse({ title: 'Private', subheading: ' Subtitle ', visibility: 'private' }), {
    title: 'Private', description: null, subheading: 'Subtitle', visibility: 'private',
  });
  assert.deepEqual(updateCollectionSchema.parse({ visibility: 'private', subheading: null }), { visibility: 'private', subheading: null });
  assert.deepEqual(updateCollectionSchema.parse({ subheading: ' Subtitle ' }), { subheading: 'Subtitle' });
  assert.equal(listCollectionsSchema.parse({ visibility: 'private' }).visibility, 'private');
  for (const visibility of ['unlisted', 'PUBLIC', null, true]) {
    assert.equal(createCollectionSchema.safeParse({ title: 'Collection', visibility }).success, false);
    assert.equal(updateCollectionSchema.safeParse({ visibility }).success, false);
    assert.equal(listCollectionsSchema.safeParse({ visibility }).success, false);
  }
  for (const subheading of [123, [], 'x'.repeat(256)]) {
    assert.equal(createCollectionSchema.safeParse({ title: 'Collection', subheading }).success, false);
    assert.equal(updateCollectionSchema.safeParse({ subheading }).success, false);
  }
  assert.equal(createCollectionSchema.parse({ title: 'Collection', subheading: 'x'.repeat(255) }).subheading.length, 255);
});

test('collection listing follows quiz pagination and sorting with an optional creator filter', () => {
  const userId = '12345678-1234-4234-8234-123456789abc';
  assert.deepEqual(listCollectionsSchema.parse({}), { page: 1, limit: 20, sortBy: 'created_at', sortOrder: 'asc' });
  assert.deepEqual(listCollectionsSchema.parse({ userId, title: ' Test ', page: '2', limit: '10', sortBy: 'title', sortOrder: 'desc' }),
    { userId, title: 'Test', page: 2, limit: 10, sortBy: 'title', sortOrder: 'desc' });
  for (const query of [{ userId: 'bad' }, { page: 0 }, { page: 1.5 }, { limit: 101 }, { limit: 0 },
    { sortBy: 'title; DROP TABLE collections' }, { sortOrder: 'DESC' }, { created_by: userId },
    { page: String(Number.MAX_SAFE_INTEGER), limit: 100 }, { title: ['one', 'two'] },
  ]) assert.equal(listCollectionsSchema.safeParse(query).success, false);
});

test('collection PATCH preserves omission, accepts null descriptions and rejects readonly fields', () => {
  assert.deepEqual(updateCollectionSchema.parse({ title: ' Updated ' }), { title: 'Updated' });
  assert.deepEqual(updateCollectionSchema.parse({ description: null }), { description: null });
  for (const body of [{}, { title: null }, { title: ' ' }, { description: 1 }, { created_by: 'spoof' },
    { thumbnail_url: 'https://example.com/image.jpg' }, { playlist_ids: [] },
  ]) assert.equal(updateCollectionSchema.safeParse(body).success, false);
});

test('membership input validates UUIDs and rejects duplicate IDs including case variants', () => {
  const id = '12345678-1234-4234-8234-123456789abc';
  assert.deepEqual(addCollectionPlaylistsSchema.parse({ playlist_ids: [id.toUpperCase()] }), { playlist_ids: [id] });
  assert.equal(addCollectionPlaylistsSchema.safeParse({ playlist_ids: [] }).success, false);
  assert.equal(reorderCollectionPlaylistsSchema.safeParse({ playlist_ids: [] }).success, true);
  for (const schema of [addCollectionPlaylistsSchema, reorderCollectionPlaylistsSchema]) {
    for (const body of [undefined, null, {}, { playlist_ids: null }, { playlist_ids: id },
      { playlist_ids: ['bad'] }, { playlist_ids: [id, id.toUpperCase()] }, { playlist_ids: [id], created_by: id },
    ]) assert.equal(schema.safeParse(body).success, false);
  }
});

test('collection creation rejects invalid text, readonly fields and thumbnail or playlist inputs', () => {
  for (const body of [undefined, null, [], {}, { title: '' }, { title: ' ' }, { title: 1 },
    { title: 'x'.repeat(256) }, { title: 'Collection', description: 1 },
    ...['id', 'created_by', 'created_at', 'updated_at', 'thumbnail_url', 'playlist_ids'].map(field => ({ title: 'Collection', [field]: null })),
  ]) assert.equal(createCollectionSchema.safeParse(body).success, false, JSON.stringify(body));
  assert.throws(() => requireCollectionUser(), { status: 401 });
});
