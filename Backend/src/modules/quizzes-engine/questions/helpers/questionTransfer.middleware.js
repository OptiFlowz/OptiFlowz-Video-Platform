import express from 'express';
import multer from 'multer';
import { MAX_XML_BYTES } from './moodleXml.js';
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_XML_BYTES, files: 1, fields: 0, parts: 2 } }).single('file');
const raw = express.raw({ type: ['application/xml', 'text/xml'], limit: MAX_XML_BYTES, inflate: false });
export function receiveQuestionXml(req, res, next) {
  const multipart = req.is('multipart/form-data');
  if (!multipart && !req.is(['application/xml', 'text/xml'])) return res.status(415).json({ success:false, message:'Use application/xml, text/xml or multipart/form-data with a file field' });
  const parser = multipart ? upload : raw;
  parser(req, res, error => {
    if (!error) return next();
    const status = error.code === 'LIMIT_FILE_SIZE' || error.status === 413 ? 413 : 400;
    return res.status(status).json({ success:false, message:status === 413 ? 'XML file exceeds 5 MiB' : 'Invalid XML upload; send one file field and no other form fields' });
  });
}
