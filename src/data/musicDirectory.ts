import { MusicTrack } from '../types';

export const DEFAULT_MUSIC_DIRECTORY: MusicTrack[] = [
  {
    id: 'track-chillhop-1',
    title: 'Coffee Shop Radio - 24/7 Chillhop & Jazzy Beats',
    artist: 'Chillhop Music',
    youtubeUrl: 'https://www.youtube.com/watch?v=5yx6BWlEVcY',
    youtubeVideoId: '5yx6BWlEVcY',
    category: 'chill',
    duration: '24/7 Stream',
    thumbnail: 'https://img.youtube.com/vi/5yx6BWlEVcY/hqdefault.jpg',
  },
  {
    id: 'track-lofi-1',
    title: 'lofi hip hop radio - beats to relax/study to',
    artist: 'Lofi Girl',
    youtubeUrl: 'https://www.youtube.com/watch?v=jfKfPfyJRdk',
    youtubeVideoId: 'jfKfPfyJRdk',
    category: 'lofi',
    duration: '24/7 Live Stream',
    thumbnail: 'https://img.youtube.com/vi/jfKfPfyJRdk/hqdefault.jpg',
  },
  {
    id: 'track-piano-1',
    title: 'Peaceful Piano & Soft Rain Study Session',
    artist: 'Calm Soundscapes',
    youtubeUrl: 'https://www.youtube.com/watch?v=WPni755-Krg',
    youtubeVideoId: 'WPni755-Krg',
    category: 'piano',
    duration: '3:15:00',
    thumbnail: 'https://img.youtube.com/vi/WPni755-Krg/hqdefault.jpg',
  },
  {
    id: 'track-synth-1',
    title: 'synthwave radio - chill synth / coding beats',
    artist: 'Lofi Girl',
    youtubeUrl: 'https://www.youtube.com/watch?v=4xDzrJKXOOY',
    youtubeVideoId: '4xDzrJKXOOY',
    category: 'synthwave',
    duration: '24/7 Live Stream',
    thumbnail: 'https://img.youtube.com/vi/4xDzrJKXOOY/hqdefault.jpg',
  },
  {
    id: 'track-ghibli-1',
    title: 'Relaxing Studio Ghibli Piano Collection',
    artist: 'Cafe Music BGM',
    youtubeUrl: 'https://www.youtube.com/watch?v=04m74nflP44',
    youtubeVideoId: '04m74nflP44',
    category: 'piano',
    duration: '2:40:00',
    thumbnail: 'https://img.youtube.com/vi/04m74nflP44/hqdefault.jpg',
  },
  {
    id: 'track-ambient-1',
    title: 'Deep Coding & Focus Ambient Atmosphere',
    artist: 'SomaFM / Focus Mode',
    youtubeUrl: 'https://www.youtube.com/watch?v=1T_DcrYk3O0',
    youtubeVideoId: '1T_DcrYk3O0',
    category: 'ambient',
    duration: '1:48:00',
    thumbnail: 'https://img.youtube.com/vi/1T_DcrYk3O0/hqdefault.jpg',
  },
];

/**
 * Extracts a YouTube video ID from various YouTube URL formats.
 * Supports:
 * - https://www.youtube.com/watch?v=VIDEO_ID
 * - https://youtu.be/VIDEO_ID
 * - https://www.youtube.com/embed/VIDEO_ID
 * - https://www.youtube.com/live/VIDEO_ID (and /shorts/VIDEO_ID)
 * - Or raw 11-char video ID
 */
export function extractYouTubeVideoId(input: string): string | null {
  if (!input || typeof input !== 'string') return null;
  const trimmed = input.trim();

  // If already an 11-character video ID
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) {
    return trimmed;
  }

  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.toLowerCase();
    const segments = url.pathname.split('/').filter(Boolean);
    let videoId: string | null = null;

    if (host === 'youtu.be') {
      if (segments.length === 1) videoId = segments[0];
    } else if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'music.youtube.com',
      'youtube-nocookie.com', 'www.youtube-nocookie.com'].includes(host)) {
      if (url.pathname === '/watch') {
        videoId = url.searchParams.get('v');
      } else if (segments.length === 2 && ['embed', 'live', 'shorts', 'v', 'e'].includes(segments[0])) {
        videoId = segments[1];
      }
    }

    return videoId && /^[a-zA-Z0-9_-]{11}$/.test(videoId) ? videoId : null;
  } catch {
    return null;
  }
}
