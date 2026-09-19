import { randomUUID } from 'crypto';
import sharp from 'sharp';
import { PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { s3 } from '../../storage/r2.client.js';
import { HttpError } from '../../../common/httpError.js';

export const MAX_POST_IMAGE_BYTES = 5 * 1024 * 1024;
export const POST_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validatePostImageFile(file) {
  if (!POST_IMAGE_MIME_TYPES.includes(file.mimetype)
    || !Buffer.isBuffer(file.buffer) || file.buffer.length === 0
    || file.buffer.length > MAX_POST_IMAGE_BYTES) {
    throw new HttpError(400, { message: 'Images must be JPEG, PNG or WebP files up to 5 MB' });
  }
}

export function validateBlockFiles(block, files) {
  const allowed = block.type === 'image'
    ? ['file']
    : (block.options || []).map((_, index) => `option_${index}`);
  for (const [field, uploads] of Object.entries(files)) {
    if (!allowed.includes(field) || uploads.length !== 1) {
      throw new HttpError(400, { message: `Unexpected image field: ${field}` });
    }
    validatePostImageFile(uploads[0]);
  }
  if (block.type === 'image' && !files.file?.length) {
    throw new HttpError(400, { message: 'An image block requires the file upload field' });
  }
}

export async function uploadPostImage(postId, file, uploadedObjects) {
  const bucket = process.env.R2_BUCKET;
  const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!bucket || !baseUrl) throw new HttpError(500, { message: 'Post image storage is not configured' });

  let buffer;
  try {
    const image = sharp(file.buffer, { limitInputPixels: 40000000 });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Unsupported image');
    buffer = await image.rotate()
      .resize({ width: 1920, height: 1920, fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 }).toBuffer();
  } catch {
    throw new HttpError(400, { message: 'Invalid or unsupported image data' });
  }

  const key = `posts/${postId}/${randomUUID()}.webp`;
  uploadedObjects.push({ Bucket: bucket, Key: key });
  await s3.send(new PutObjectCommand({
    Bucket: bucket, Key: key, Body: buffer, ContentType: 'image/webp',
    CacheControl: 'public, max-age=31536000, immutable',
  }));
  return `${baseUrl}/${key}`;
}

export async function cleanupPostImages(uploadedObjects) {
  for (const object of uploadedObjects) {
    try {
      await s3.send(new DeleteObjectCommand(object));
    } catch (error) {
      console.warn('Post image cleanup failed:', object.Key, error?.message || error);
    }
  }
}

export function getPostImageObjects(postId, imageUrls) {
  const urls = imageUrls.filter(url => typeof url === 'string' && url.length > 0);
  if (!urls.length) return [];
  const bucket = process.env.R2_BUCKET;
  const baseUrl = (process.env.R2_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  if (!bucket || !baseUrl) throw new HttpError(500, { message: 'Post image storage is not configured' });

  const keys = new Set();
  for (const url of urls) {
    if (!url.startsWith(`${baseUrl}/`)) continue;
    const key = url.slice(baseUrl.length + 1);
    // Only delete files in this post's upload namespace, never arbitrary bucket keys.
    const match = /^posts\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.webp$/i.exec(key);
    if (match && match[1].toLowerCase() === postId.toLowerCase()) keys.add(key);
  }
  return [...keys].map(Key => ({ Bucket: bucket, Key }));
}

export async function deletePostImages(objects) {
  for (const object of objects) {
    try {
      // Deleting an already absent object is safe when retrying a partial deletion.
      await s3.send(new DeleteObjectCommand(object));
    } catch (error) {
      console.error('Post image deletion failed:', object.Key, error?.message || error);
      throw new HttpError(502, { message: 'Could not delete post images. Retry the deletion request.' });
    }
  }
}
