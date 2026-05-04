import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object) {
  const schema = z.object({
    sourceId: z.string().uuid('Invalid source ID'),

    source_type: z.enum([
      'playlist',
      'video',
      'general',
      'manual'
    ], 'Invalid source type').optional(),

    playlist_id: z.string().uuid('Invalid playlist ID').optional().nullable(),
    video_id: z.string().uuid('Invalid video ID').optional().nullable(),

    percentage: z.coerce.number().min(0).max(100).optional().nullable(),
    fixed_question_count: z.coerce.number().int().min(1).optional().nullable(),

    include_general_questions: z.boolean().optional(),
  });

  return validateOrThrow(schema.safeParse(object));
}

export async function updateQuizQuestionSourceInternal(object, userId) {
  const {
    sourceId,
    source_type,
    playlist_id,
    video_id,
    percentage,
    fixed_question_count,
    include_general_questions,
  } = prerequisites(object);

  const { rows: sourceRows } = await writePool.query(
    `
      SELECT *
      FROM quiz_question_sources
      WHERE id = $1
      LIMIT 1;
    `,
    [sourceId]
  );

  if (sourceRows.length === 0) {
    const error = new Error('Quiz question source not found.');
    error.status = 404;
    throw error;
  }

  const existingSource = sourceRows[0];

  await assertQuizOwner(existingSource.quiz_id, userId);

  const nextSourceType = source_type ?? existingSource.source_type;

  const nextPlaylistId =
    Object.prototype.hasOwnProperty.call(object, 'playlist_id')
      ? playlist_id
      : existingSource.playlist_id;

  const nextVideoId =
    Object.prototype.hasOwnProperty.call(object, 'video_id')
      ? video_id
      : existingSource.video_id;

  const nextPercentage =
    Object.prototype.hasOwnProperty.call(object, 'percentage')
      ? percentage
      : existingSource.percentage;

  const nextFixedQuestionCount =
    Object.prototype.hasOwnProperty.call(object, 'fixed_question_count')
      ? fixed_question_count
      : existingSource.fixed_question_count;

  const nextIncludeGeneralQuestions =
    Object.prototype.hasOwnProperty.call(object, 'include_general_questions')
      ? include_general_questions
      : existingSource.include_general_questions;

  if (nextPercentage == null && nextFixedQuestionCount == null) {
    const error = new Error('Either percentage or fixed_question_count is required.');
    error.status = 400;
    throw error;
  }

  if (nextPercentage != null && nextFixedQuestionCount != null) {
    const error = new Error('Send either percentage or fixed_question_count, not both.');
    error.status = 400;
    throw error;
  }

  let finalPlaylistId = nextPlaylistId;
  let finalVideoId = nextVideoId;

  if (nextSourceType === 'playlist') {
    if (!finalPlaylistId) {
      const error = new Error('playlist_id is required for playlist source.');
      error.status = 400;
      throw error;
    }

    finalVideoId = null;
  }

  if (nextSourceType === 'video') {
    if (!finalVideoId) {
      const error = new Error('video_id is required for video source.');
      error.status = 400;
      throw error;
    }

    finalPlaylistId = null;
  }

  if (nextSourceType === 'general' || nextSourceType === 'manual') {
    finalPlaylistId = null;
    finalVideoId = null;
  }

  const fieldsToUpdate = [];
  const queryParams = [];

  function addField(column, value) {
    queryParams.push(value);
    fieldsToUpdate.push(`${column} = $${queryParams.length}`);
  }

  if (Object.prototype.hasOwnProperty.call(object, 'source_type')) {
    addField('source_type', nextSourceType);
  }

  if (
    Object.prototype.hasOwnProperty.call(object, 'playlist_id') ||
    source_type === 'video' ||
    source_type === 'general' ||
    source_type === 'manual'
  ) {
    addField('playlist_id', finalPlaylistId);
  }

  if (
    Object.prototype.hasOwnProperty.call(object, 'video_id') ||
    source_type === 'playlist' ||
    source_type === 'general' ||
    source_type === 'manual'
  ) {
    addField('video_id', finalVideoId);
  }

  if (Object.prototype.hasOwnProperty.call(object, 'percentage')) {
    addField('percentage', nextPercentage);
  }

  if (Object.prototype.hasOwnProperty.call(object, 'fixed_question_count')) {
    addField('fixed_question_count', nextFixedQuestionCount);
  }

  if (Object.prototype.hasOwnProperty.call(object, 'include_general_questions')) {
    addField('include_general_questions', nextIncludeGeneralQuestions);
  }

  if (fieldsToUpdate.length === 0) {
    const error = new Error('No fields to update.');
    error.status = 400;
    throw error;
  }

  queryParams.push(sourceId);

  const { rows } = await writePool.query(
    `
      UPDATE quiz_question_sources
      SET ${fieldsToUpdate.join(', ')}
      WHERE id = $${queryParams.length}
      RETURNING *;
    `,
    queryParams
  );

  return rows[0] || null;
}