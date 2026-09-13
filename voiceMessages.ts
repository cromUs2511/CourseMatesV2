import crypto from 'node:crypto';
import { CHAT_VOICE_TYPES, MAX_VOICE_BYTES, MAX_VOICE_DURATION_SECONDS } from './src/data/chatVoice';

export type StoredVoice = { id: string; mimeType: string; bytes: Buffer; duration: number };

export function parseVoice(value: unknown): StoredVoice | undefined {
  if (value === undefined || value === null) return undefined;
  const voice = value as Record<string, unknown>;
  if (!voice || typeof voice.dataUrl !== 'string' || voice.dataUrl.length > Math.ceil(MAX_VOICE_BYTES / 3) * 4 + 80) {
    throw new Error('Voice messages must be 4 MB or smaller.');
  }
  const match = /^data:(audio\/(?:webm|mp4|ogg|mpeg))(?:;codecs=[^;,]+)?;base64,([A-Za-z0-9+/]+={0,2})$/.exec(voice.dataUrl);
  if (!match || !CHAT_VOICE_TYPES.includes(match[1])) throw new Error('This voice recording format is not supported.');
  const bytes = Buffer.from(match[2], 'base64');
  const validHeader = match[1] === 'audio/webm' ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
    : match[1] === 'audio/ogg' ? bytes.toString('ascii', 0, 4) === 'OggS'
    : match[1] === 'audio/mpeg' ? bytes.toString('ascii', 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)
    : bytes.toString('ascii', 4, 8) === 'ftyp';
  const duration = Number(voice.duration);
  if (!validHeader || !bytes.length || bytes.length > MAX_VOICE_BYTES || bytes.toString('base64') !== match[2]) throw new Error('This voice recording is invalid or too large.');
  if (!Number.isInteger(duration) || duration < 1 || duration > MAX_VOICE_DURATION_SECONDS) throw new Error('Voice messages can be up to 3 minutes long.');
  return { id: crypto.randomUUID(), mimeType: match[1], bytes, duration };
}
