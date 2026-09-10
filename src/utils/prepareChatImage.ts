import { CHAT_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_DIMENSION, MAX_SOURCE_IMAGE_BYTES, type ImageUpload } from '../data/chatImages';

export async function prepareChatImage(file: File): Promise<ImageUpload> {
  if (!CHAT_IMAGE_TYPES.includes(file.type)) throw new Error('Choose a JPEG, PNG, or WebP photo.');
  if (!file.size || file.size > MAX_SOURCE_IMAGE_BYTES) throw new Error('Choose photos smaller than 10 MB each.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode().catch(() => { throw new Error('This photo could not be opened. Choose another image.'); });
    const scale = Math.min(1, MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
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
        return { name: file.name.slice(0, 120), dataUrl, width: canvas.width, height: canvas.height };
      }
    }
    throw new Error('This photo is too detailed to send. Try a smaller image.');
  } finally { URL.revokeObjectURL(url); }
}
