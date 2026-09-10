import crypto from 'node:crypto';
import { CHAT_IMAGE_TYPES, MAX_CHAT_IMAGES, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION } from './src/data/chatImages';

export const MAX_ROOM_IMAGE_BYTES = 24 * 1024 * 1024;
export type StoredImage = { id: string; name: string; mimeType: string; bytes: Buffer; width: number; height: number };

export function parseImages(value: unknown): StoredImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_IMAGES) throw new Error('Attach up to 4 photos per message.');
  return value.map(image => {
    if (!image || typeof image.dataUrl !== 'string' || image.dataUrl.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 40) {
      throw new Error('Each prepared photo must be 1 MB or smaller.');
    }
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(image.dataUrl);
    if (!match || !CHAT_IMAGE_TYPES.includes(match[1])) throw new Error('Choose a JPEG, PNG, or WebP image.');
    const bytes = Buffer.from(match[2], 'base64');
    const mimeType = match[1];
    const validHeader = mimeType === 'image/jpeg' ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
      : mimeType === 'image/png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    if (!validHeader || !bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) {
      throw new Error('This photo is invalid or too large. Choose another image.');
    }
    if (![image.width, image.height].every(size => Number.isInteger(size) && size > 0 && size <= MAX_IMAGE_DIMENSION)) {
      throw new Error('Photo dimensions must be between 1 and 1600 pixels.');
    }
    return { id: crypto.randomUUID(), name: typeof image.name === 'string' ? image.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 120) || 'Photo' : 'Photo',
      mimeType, bytes, width: image.width, height: image.height };
  });
}
