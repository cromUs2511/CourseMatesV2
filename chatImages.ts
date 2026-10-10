import crypto from 'node:crypto';
import {
  CHAT_IMAGE_TYPES,
  MAX_CHAT_IMAGES,
  MAX_GIF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_MESSAGE_MEDIA_BYTES,
} from './src/data/chatImages';

export const MAX_ROOM_IMAGE_BYTES = 24 * 1024 * 1024;
export type StoredImage = {
  id: string;
  name: string;
  mimeType: string;
  bytes: Buffer;
  width: number;
  height: number;
};

function stripControlCharacters(value: string): string {
  let cleaned = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x1f && code !== 0x7f) cleaned += character;
  }
  return cleaned;
}

export function parseImages(value: unknown): StoredImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_IMAGES)
    throw new Error('Attach up to 4 photos per message.');
  const parsed = value.map((image) => {
    if (
      !image ||
      typeof image.dataUrl !== 'string' ||
      image.dataUrl.length > Math.ceil(MAX_GIF_BYTES / 3) * 4 + 40
    ) {
      throw new Error('Each prepared image is too large.');
    }
    const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(
      image.dataUrl,
    );
    const mimeType = match?.[1];
    const payload = match?.[2];
    if (!mimeType || !payload || !CHAT_IMAGE_TYPES.includes(mimeType))
      throw new Error('Choose a JPEG, PNG, WebP, or GIF image.');
    const bytes = Buffer.from(payload, 'base64');
    const validHeader =
      mimeType === 'image/jpeg'
        ? bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
        : mimeType === 'image/png'
          ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
          : mimeType === 'image/gif'
            ? ['GIF87a', 'GIF89a'].includes(bytes.toString('ascii', 0, 6))
            : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
    const byteLimit = mimeType === 'image/gif' ? MAX_GIF_BYTES : MAX_IMAGE_BYTES;
    if (
      !validHeader ||
      !bytes.length ||
      bytes.length > byteLimit ||
      bytes.toString('base64') !== payload
    ) {
      throw new Error('This photo is invalid or too large. Choose another image.');
    }
    if (
      ![image.width, image.height].every(
        (size) => Number.isInteger(size) && size > 0 && size <= MAX_IMAGE_DIMENSION,
      )
    ) {
      throw new Error('Photo dimensions must be between 1 and 1600 pixels.');
    }
    return {
      id: crypto.randomUUID(),
      name:
        typeof image.name === 'string'
          ? stripControlCharacters(image.name).slice(0, 120) || 'Photo'
          : 'Photo',
      mimeType,
      bytes,
      width: image.width,
      height: image.height,
    };
  });
  if (parsed.reduce((total, image) => total + image.bytes.length, 0) > MAX_MESSAGE_MEDIA_BYTES)
    throw new Error('Attachments must total 4 MB or less per message.');
  return parsed;
}
