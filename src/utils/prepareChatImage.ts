import {
  CHAT_IMAGE_TYPES,
  MAX_GIF_BYTES,
  MAX_IMAGE_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_SOURCE_IMAGE_BYTES,
  type ImageUpload,
} from '../data/chatImages';
import { screenImagePixels } from '../data/imageNudity';

/** On-device nudity pre-screen. Runs on a 64 px thumbnail so it costs almost
 * nothing, and refuses blatant exposure before a photo can even attach.
 * Determined senders can bypass any client check, so user reports plus the
 * server image-hash denylist remain the enforcement backstop.
 */
async function screenPreparedPhoto(image: HTMLImageElement): Promise<void> {
  const naturalWidth = image.naturalWidth;
  const naturalHeight = image.naturalHeight;
  const side = 64;
  const scale = Math.min(1, side / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return;
  context.drawImage(image, 0, 0, width, height);
  const verdict = screenImagePixels(context.getImageData(0, 0, width, height).data, width, height);
  if (!verdict.allowed) throw new Error('This photo appears to contain nudity and can’t be sent.');
}

const readDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === 'string'
        ? resolve(reader.result)
        : reject(new Error('This GIF could not be opened.'));
    reader.onerror = () => reject(new Error('This GIF could not be opened.'));
    reader.readAsDataURL(file);
  });

export async function prepareChatImage(file: File): Promise<ImageUpload> {
  if (!CHAT_IMAGE_TYPES.includes(file.type))
    throw new Error('Choose a JPEG, PNG, WebP, or GIF image.');
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES)
    throw new Error('Choose photos smaller than 10 MB each.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => {
      throw new Error('This photo could not be opened. Choose another image.');
    });
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('This image has invalid dimensions.');
    await screenPreparedPhoto(image);
    if (file.type === 'image/gif') {
      if (Math.max(image.naturalWidth, image.naturalHeight) > MAX_IMAGE_DIMENSION)
        throw new Error('GIFs must be no larger than 1600 pixels on either side.');
      if (file.size > MAX_GIF_BYTES) throw new Error('Choose a GIF smaller than 3 MB.');
      return {
        name: file.name.slice(0, 120),
        dataUrl: await readDataUrl(file),
        width: image.naturalWidth,
        height: image.naturalHeight,
      };
    }
    const scale = Math.min(
      1,
      MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
    );
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Your browser could not prepare this photo.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    // Re-encoding also removes the source photo's location and camera metadata.
    for (const quality of [0.88, 0.75, 0.6]) {
      const dataUrl = canvas.toDataURL('image/webp', quality);
      if ((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75 <= MAX_IMAGE_BYTES) {
        return {
          name: file.name.slice(0, 120),
          dataUrl,
          width: canvas.width,
          height: canvas.height,
        };
      }
    }
    throw new Error('This photo is too detailed to send. Try a smaller image.');
  } finally {
    URL.revokeObjectURL(url);
  }
}
