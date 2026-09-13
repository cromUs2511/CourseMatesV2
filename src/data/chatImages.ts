export const MAX_CHAT_IMAGES = 4;
export const MAX_IMAGE_BYTES = 1024 * 1024;
export const MAX_GIF_BYTES = 3 * 1024 * 1024;
export const MAX_MESSAGE_MEDIA_BYTES = 4 * 1024 * 1024;
export const MAX_IMAGE_DIMENSION = 1600;
export const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
export const CHAT_SEND_BODY_LIMIT = '7mb';

export interface ImageUpload {
  name: string;
  dataUrl: string;
  width: number;
  height: number;
}

export interface ChatImage {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}
