import multer from 'multer';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 2MB, promeni po potrebi
});

export const subtitleUploadMiddleware = upload.single('file');

export const videoThumbnailUploadMiddleware = upload.single('file');
