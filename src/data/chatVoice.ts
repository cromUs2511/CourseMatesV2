export const MAX_VOICE_DURATION_SECONDS = 180;
export const MAX_VOICE_BYTES = 2 * 1024 * 1024;
export const CHAT_VOICE_TYPES = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg'];

export interface VoiceUpload {
  dataUrl: string;
  duration: number;
}

export interface ChatVoice {
  id: string;
  url: string;
  duration: number;
  mimeType: string;
}
