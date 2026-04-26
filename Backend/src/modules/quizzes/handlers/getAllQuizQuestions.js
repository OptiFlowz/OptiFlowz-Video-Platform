import { writePool } from '../../../database/index.js';
import { z } from 'zod';
import { validateOrThrow } from '../../../common/input.validation.js';
import { assertQuizOwner } from '../../../common/quizOwnership.js';

function prerequisites(object, userId) {
  const schema = z.object({
    quizId: z.string().uuid('Invalid quiz ID'),

    page: z.coerce.number().int().min(1).optional().default(1),
    limit: z.coerce.number().int().min(1).max(100).optional().default(10),

    sortBy: z
      .enum(['position', 'created_at', 'updated_at', 'points', 'question_text'])
      .optional()
      .default('position'),

    sortOrder: z
      .enum(['asc', 'desc'])
      .optional()
      .default('asc'),
  });

  if (!userId) {
    const error = new Error('Unauthorized');
    error.status = 401;
    throw error;
  }

  return validateOrThrow(schema.safeParse(object));
}

function getSortColumn(sortBy) {
  const allowedColumns = {
    position: 'q.position',
    created_at: 'q.created_at',
    updated_at: 'q.updated_at',
    points: 'q.points',
    question_text: 'q.question_text',
  };

  return allowedColumns[sortBy] || allowedColumns.position;
}

export async function getAllQuizQuestionsInternal(object, userId = null) {
  const data = prerequisites(object, userId);

  await assertQuizOwner(data.quizId, userId);

  const page = data.page;
  const limit = data.limit;
  const sortBy = data.sortBy;
  const sortOrder = data.sortOrder;

  const offset = (page - 1) * limit;
  const sortColumn = getSortColumn(sortBy);
  const safeSortOrder = sortOrder.toUpperCase();

  const client = await writePool.connect();

  try {
    const totalResult = await client.query(
      `
        SELECT COUNT(*)::int AS total
        FROM quiz_questions
        WHERE quiz_id = $1
      `,
      [data.quizId]
    );

    const total = totalResult.rows[0]?.total || 0;
    const totalPages = Math.ceil(total / limit);

    const questionsResult = await client.query(
      `
        SELECT *
        FROM quiz_questions q
        WHERE q.quiz_id = $1
        ORDER BY ${sortColumn} ${safeSortOrder}, q.created_at ASC
        LIMIT $2 OFFSET $3
      `,
      [data.quizId, limit, offset]
    );

    const questions = questionsResult.rows;

    if (questions.length > 0) {
      const questionIds = questions.map((question) => question.id);

      const optionsResult = await client.query(
        `
          SELECT *
          FROM quiz_question_options
          WHERE question_id = ANY($1::uuid[])
          ORDER BY position ASC, created_at ASC
        `,
        [questionIds]
      );

      const pairsResult = await client.query(
        `
          SELECT *
          FROM quiz_matching_pairs
          WHERE question_id = ANY($1::uuid[])
          ORDER BY position ASC, created_at ASC
        `,
        [questionIds]
      );

      const optionsByQuestionId = optionsResult.rows.reduce((acc, option) => {
        if (!acc[option.question_id]) {
          acc[option.question_id] = [];
        }

        acc[option.question_id].push(option);
        return acc;
      }, {});

      const pairsByQuestionId = pairsResult.rows.reduce((acc, pair) => {
        if (!acc[pair.question_id]) {
          acc[pair.question_id] = [];
        }

        acc[pair.question_id].push(pair);
        return acc;
      }, {});

      for (const question of questions) {
        question.options = optionsByQuestionId[question.id] || [];
        question.pairs = pairsByQuestionId[question.id] || [];
      }
    }

    return {
      questions,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1,
      },
      sorting: {
        sortBy,
        sortOrder,
      },
    };
  } finally {
    client.release();
  }
}