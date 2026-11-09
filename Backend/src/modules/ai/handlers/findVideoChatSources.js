import { videoChatSchema } from '../videoChat.schema.js';
import { HttpError } from '../../../common/httpError.js';
import { embedTexts } from '../../video-indexing/embedding.service.js';
import { queryTranscriptSegments } from '../repository/transcriptSegments.js';

export async function findVideoChatSources(body) {
  const parsed = videoChatSchema.safeParse(body);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, { message: [issue.path.join('.'), issue.message].filter(Boolean).join(': ') });
  }

  const { video_ids, question, mode, section, language, document_type } = parsed.data;
  let embedding = null;
  if (mode === 'semantic') {
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(503, { message: 'Vector search is not configured' });
    }
    try {
      [embedding] = await embedTexts([question], new AbortController().signal);
    } catch {
      throw new HttpError(502, { message: 'Could not embed the question. Please try again.' });
    }
  }

  return queryTranscriptSegments(video_ids, section, embedding, { language, document_type });
}
