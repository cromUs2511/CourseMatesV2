export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  stopVideo(): void;
  loadVideoById(
    video: string | { videoId: string; startSeconds: number; endSeconds?: number },
  ): void;
  cueVideoById(
    video: string | { videoId: string; startSeconds: number; endSeconds?: number },
  ): void;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  getCurrentTime(): number;
  mute(): void;
  unMute(): void;
  setVolume(volume: number): void;
  destroy(): void;
}

interface PlayerEvent {
  target: YouTubePlayer;
}

export interface YouTubePlayerOptions {
  width: number;
  height: number;
  videoId: string;
  playerVars: Record<string, string | number>;
  events: {
    onReady(event: PlayerEvent): void;
    onStateChange(event: PlayerEvent & { data: number }): void;
    onError(event: PlayerEvent & { data: number }): void;
    onAutoplayBlocked(event: PlayerEvent): void;
  };
}

interface YouTubeAPI {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
}

declare global {
  interface Window {
    YT?: YouTubeAPI;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YouTubeAPI> | null = null;

// Share one script across mounts (including React StrictMode), and allow retries.
export function loadYouTubeAPI(): Promise<YouTubeAPI> {
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeAPI>((resolve, reject) => {
    const script = document.createElement('script');
    const previousCallback = window.onYouTubeIframeAPIReady;
    const cleanup = () => {
      window.clearTimeout(timeout);
      script.onerror = null;
      if (window.onYouTubeIframeAPIReady === onReady) {
        window.onYouTubeIframeAPIReady = previousCallback;
      }
    };
    const fail = () => {
      cleanup();
      script.remove();
      apiPromise = null;
      reject(
        new Error(
          'YouTube could not load. Check your connection or content blocker, then try again.',
        ),
      );
    };
    const onReady = () => {
      if (!window.YT?.Player) {
        fail();
        return;
      }
      cleanup();
      resolve(window.YT);
      previousCallback?.();
    };
    const timeout = window.setTimeout(fail, 15000);
    window.onYouTubeIframeAPIReady = onReady;
    script.src = 'https://www.youtube.com/iframe_api';
    script.async = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });

  return apiPromise;
}

export function getYouTubeErrorMessage(code: number): string {
  switch (code) {
    case 2:
      return 'This YouTube video ID is invalid. Try another link.';
    case 100:
      return 'This video is unavailable or private. Choose another track.';
    case 101:
    case 150:
      return 'This track cannot play in the embedded audio player. Choose another track.';
    case 153:
      return 'This track could not be verified for embedded audio playback. Choose another track.';
    default:
      return 'YouTube could not play this track. Try again or choose another track.';
  }
}

/** Error codes that mean the video itself forbids embedding (never a gesture issue). */
export function isEmbedForbiddenError(code: number): boolean {
  return code === 101 || code === 150 || code === 153;
}

/** True on iOS/iPadOS, where autoplay with sound always needs a tap. */
export function isAppleTouchDevice(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  const platform = (navigator as Navigator & { userAgentData?: unknown }).platform || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ reports as Macintosh but has touch points.
  if (/Macintosh/i.test(ua) && (navigator as Navigator).maxTouchPoints > 1) return true;
  if (/Mac/i.test(platform) && (navigator as Navigator).maxTouchPoints > 1) return true;
  return false;
}

export function isIOSOrSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  if (isAppleTouchDevice()) return true;
  // Desktop Safari also blocks programmatic unmuted playback.
  const isSafari = /^((?!chrome|chromium|crios|fxios|edg).)*safari/i.test(ua);
  return isSafari;
}

/**
 * Safari suspends or rejects playback from display:none / 1px clipped iframes.
 * Call after creating a YT.Player so the underlying iframe stays eligible:
 * keeps it rendered (real size, offscreen) with autoplay permission.
 */
export function prepareYouTubeIframe(container: HTMLElement | null): void {
  if (!container) return;
  const iframe = container.querySelector('iframe');
  if (!iframe) return;
  try {
    const allow = iframe.getAttribute('allow') || '';
    if (!/autoplay/i.test(allow))
      iframe.setAttribute(
        'allow',
        [allow, 'autoplay; encrypted-media; picture-in-picture'].filter(Boolean).join('; '),
      );
    iframe.setAttribute('playsinline', 'true');
    iframe.setAttribute('webkit-playsinline', 'true');
  } catch {
    /* Best effort; playback still works without these hints. */
  }
}
