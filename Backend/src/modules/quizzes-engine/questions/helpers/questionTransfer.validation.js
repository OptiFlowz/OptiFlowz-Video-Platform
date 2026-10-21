import { z } from 'zod';
const uuid = z.string().uuid().transform(value => value.toLowerCase());
export const importQuestionsSchema = z.object({ category_id: uuid.optional() }).strict();
export const exportQuestionsSchema = z.object({
  category_id: uuid.optional(),
  type: z.enum(['single_choice', 'multiple_choice', 'matching']).optional(),
  question_ids: z.string().transform(value => value.split(',')).pipe(z.array(uuid).min(1).max(1000))
    .transform(ids => [...new Set(ids)]).optional(),
}).strict();
