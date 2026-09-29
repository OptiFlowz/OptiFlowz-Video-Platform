import multer from 'multer';
import { sendError } from '../../common/response.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } }).single('file');

export function liveThumbnailUploadMiddleware(req, res, next) {
  upload(req, res, error => {
    if (error) return sendError(res, error.code === 'LIMIT_FILE_SIZE' ? 'Image must not exceed 5 MB' : 'Invalid file upload', 400);
    next();
  });
}
