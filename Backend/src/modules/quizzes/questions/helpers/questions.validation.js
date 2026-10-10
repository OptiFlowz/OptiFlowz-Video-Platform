import { z } from 'zod';
import { HttpError } from '../../../../common/httpError.js';
import { validateOrThrow } from '../../../../common/input.validation.js';

const identifier = z.number().int().min(1).max(32767);
const position = z.number().int().min(1).max(2147483647);
const content = z.string().trim();
const questionType = z.enum(['single_choice', 'multiple_choice', 'matching']);
const groupIds = z.array(z.string().uuid('Invalid question group ID').transform(id => id.toLowerCase()))
  .transform(ids => [...new Set(ids)]);

function distinctIdentifiers(schema, field) {
  return z.array(schema).superRefine((items, context) => {
    const seen = new Set();
    items.forEach((item, index) => {
      if (seen.has(item[field])) {
        context.addIssue({ code: 'custom', path: [index, field], message: `${field} must be unique within the question` });
      }
      seen.add(item[field]);
    });
  });
}

const choiceOptions = distinctIdentifiers(z.object({
  option_no: identifier,
  content,
  is_correct: z.boolean().default(false),
  position,
}).strict(), 'option_no');

const matchingOptions = distinctIdentifiers(z.object({
  option_no: identifier,
  content,
  position,
}).strict(), 'option_no');

const matchingItems = distinctIdentifiers(z.object({
  item_no: identifier,
  content,
  correct_option_no: identifier,
  position,
}).strict(), 'item_no');

const questionFields = {
  type: questionType,
  content,
  explanation: z.string().trim().nullable(),
  options: choiceOptions,
  matching_options: matchingOptions,
  matching_items: matchingItems,
  group_ids: groupIds.optional(),
};

export const questionIdSchema = z.object({ questionId: z.string().uuid('Invalid question ID') });
export const createQuestionSchema = z.object({
  ...questionFields,
  explanation: questionFields.explanation.optional().default(null),
  options: choiceOptions.optional().default([]),
  matching_options: matchingOptions.optional().default([]),
  matching_items: matchingItems.optional().default([]),
}).strict().superRefine((question, context) => {
  if (question.type === 'matching') {
    if (question.options.length) {
      context.addIssue({ code: 'custom', path: ['options'], message: 'Matching questions cannot have choice options' });
    }
    const optionNumbers = new Set(question.matching_options.map(option => option.option_no));
    question.matching_items.forEach((item, index) => {
      if (!optionNumbers.has(item.correct_option_no)) {
        context.addIssue({ code: 'custom', path: ['matching_items', index, 'correct_option_no'], message: 'The correct matching option must belong to this question' });
      }
    });
  } else if (question.matching_options.length || question.matching_items.length) {
    context.addIssue({ code: 'custom', message: 'Choice questions cannot have matching options or items' });
  }
});

export const updateQuestionSchema = z.object(questionFields).partial().strict().refine(
  updates => Object.values(updates).some(value => value !== undefined),
  { message: 'Provide at least one question field to update' },
);

export const listQuestionsSchema = z.object({
  type: questionType.optional(),
  sortBy: z.enum(['created_at', 'updated_at', 'content', 'type']).optional().default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(20),
}).strict().refine(query => Number.isSafeInteger((query.page - 1) * query.limit), {
  message: 'Pagination offset exceeds the supported range', path: ['page'],
});

export function requireQuestionUser(userId) {
  if (!userId) throw new HttpError(401, { message: 'Unauthorized' });
}

export function mergeQuestionUpdates(question, updates) {
  const changesType = updates.type !== undefined && updates.type !== question.type;
  // On type changes, keep text but start with empty children of the new type.
  return validateOrThrow(createQuestionSchema.safeParse({
    type: updates.type ?? question.type,
    content: updates.content ?? question.content,
    explanation: updates.explanation === undefined ? question.explanation : updates.explanation,
    options: updates.options ?? (changesType ? [] : question.options),
    matching_options: updates.matching_options ?? (changesType ? [] : question.matching_options),
    matching_items: updates.matching_items ?? (changesType ? [] : question.matching_items),
    ...(updates.group_ids === undefined ? {} : { group_ids: updates.group_ids }),
  }));
}

// CRUD saves drafts. Call this validator when activation is implemented.
export function validateQuestionForActivation(input) {
  const question = validateOrThrow(createQuestionSchema.safeParse(input));
  if (!question.content) throw new HttpError(400, { message: 'An active question must have content' });
  if (question.type === 'matching') {
    if (!question.matching_options.length || !question.matching_items.length
      || [...question.matching_options, ...question.matching_items].some(item => !item.content)) {
      throw new HttpError(400, { message: 'An active matching question must have nonempty options and items' });
    }
  } else {
    const correctCount = question.options.filter(option => option.is_correct).length;
    if (question.options.some(option => !option.content)
      || (question.type === 'single_choice' ? correctCount !== 1 : correctCount < 1)) {
      throw new HttpError(400, { message: question.type === 'single_choice'
        ? 'An active single-choice question must have exactly one correct option and nonempty options'
        : 'An active multiple-choice question must have at least one correct option and nonempty options' });
    }
  }
  return question;
}
