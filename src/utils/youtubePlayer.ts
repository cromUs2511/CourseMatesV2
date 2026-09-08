export interface YouTubePlayer {
  playVideo(): void;
  pauseVideo(): void;
  loadVideoById(videoId: string): void;
  cueVideoById(videoId: string): void;
  mute(): void;
  unMute(): void;
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
      reject(new Error('YouTube could not load. Check your connection or content blocker, then try again.'));
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
      return 'This video cannot play on other websites. Choose another track or open it on YouTube.';
    case 153:
      return 'YouTube could not verify this site. Open the track on YouTube or check your browser privacy settings.';
    default:
      return 'YouTube could not play this track. Try again or choose another track.';
  }
}