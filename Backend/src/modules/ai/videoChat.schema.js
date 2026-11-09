import { z } from 'zod';

export const videoChatSchema = z.strictObject({
  video_ids: z.array(z.uuid()).min(1).max(5),
  question: z.string().trim().min(1).refine(text => Buffer.byteLength(text, 'utf8') <= 6000,
    'question must not exceed 6000 UTF-8 bytes'),
  mode: z.enum(['semantic', 'summary']).default('semantic'),
  section: z.enum(['whole', 'first_half', 'second_half']).default('whole'),
  language: z.string().trim().min(1).optional(),
  document_type: z.enum(['transcript_chunk', 'overview']).optional(),
});
