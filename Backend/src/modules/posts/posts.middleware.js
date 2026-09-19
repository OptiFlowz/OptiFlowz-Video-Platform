import multer from 'multer';
import { writePool } from '../../database/index.js';
import { validateOrThrow } from '../../common/input.validation.js';
import { sendError } from '../../common/response.js';
import { HttpError } from '../../common/httpError.js';
import { postIdSchema, postBlockIdSchema, postOptionIdSchema, MAX_BLOCK_OPTIONS } from './helpers/posts.shared.js';
import { requireEditablePost, requireDeletablePost } from './helpers/postAccess.js';
import { MAX_POST_IMAGE_BYTES, POST_IMAGE_MIME_TYPES } from './helpers/postImages.js';

export async function requirePostEditAccess(req, res, next) {
  try {
    const schema = req.params.optionId ? postOptionIdSchema : req.params.blockId ? postBlockIdSchema : postIdSchema;
    const { postId } = validateOrThrow(schema.safeParse(req.params));
    req.authorization = await requireEditablePost(writePool, postId, req.user?.sub, req.authorization);
    return next();
  } catch (error) {
    if (!error.status || error.status >= 500) return next(error);
    return sendError(res, error.message, error.status);
  }
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_POST_IMAGE_BYTES, files: MAX_BLOCK_OPTIONS, fields: 1, fieldSize: 64 * 1024 },
  fileFilter(_req, file, callback) {
    if (!POST_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return callback(new HttpError(400, { message: 'Images must be JPEG, PNG or WebP files' }));
    }
    return callback(null, true);
  },
}).fields([
  { name: 'file', maxCount: 1 },
  ...Array.from({ length: MAX_BLOCK_OPTIONS }, (_, index) => ({ name: `option_${index}`, maxCount: 1 })),
]);

export function postBlockUpload(req, res, next) {
  upload(req, res, error => {
    if (error) return sendError(res, error.message, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    if (req.is('multipart/form-data')) {
      try {
        if (Object.keys(req.body).some(key => key !== 'block') || typeof req.body.block !== 'string') {
          throw new Error('Missing block');
        }
        req.body = JSON.parse(req.body.block);
      } catch {
        return sendError(res, 'Provide a valid JSON block in the block form field', 400);
      }
    }
    return next();
  });
}

export async function requirePostDeleteAccess(req, res, next) {
  try {
    const { postId } = validateOrThrow(postIdSchema.safeParse(req.params));
    req.authorization = await requireDeletablePost(writePool, postId, req.user?.sub, req.authorization);
    return next();
  } catch (error) {
    if (!error.status || error.status >= 500) return next(error);
    return sendError(res, error.message, error.status);
  }
}

const editUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_POST_IMAGE_BYTES, files: 1, fields: 1, fieldSize: 64 * 1024 },
  fileFilter(_req, file, callback) {
    if (!POST_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      return callback(new HttpError(400, { message: 'Images must be JPEG, PNG or WebP files' }));
    }
    return callback(null, true);
  },
}).single('file');

export function postEditUpload(req, res, next) {
  editUpload(req, res, error => {
    if (error) return sendError(res, error.message, error.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
    if (req.is('multipart/form-data')) {
      try {
        if (Object.keys(req.body).some(key => key !== 'data')
          || (req.body.data !== undefined && typeof req.body.data !== 'string')) {
          throw new Error('Invalid data');
        }
        req.body = req.body.data === undefined ? {} : JSON.parse(req.body.data);
      } catch {
        return sendError(res, 'Provide valid JSON in the data form field', 400);
      }
    }
    return next();
  });
}
