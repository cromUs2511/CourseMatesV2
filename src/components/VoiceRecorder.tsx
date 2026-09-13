import React, { useEffect, useRef, useState } from 'react';
import { FileAudio, LoaderCircle, Mic, Square } from 'lucide-react';
import { CHAT_VOICE_TYPES, MAX_VOICE_BYTES, MAX_VOICE_DURATION_SECONDS, type VoiceUpload } from '../data/chatVoice';

const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const readDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('The recording could not be prepared.'));
  reader.onerror = () => reject(new Error('The recording could not be prepared.'));
  reader.readAsDataURL(blob);
});

export function VoiceRecorder({ disabled, hasVoice, onChange, onError, onRecordingChange }: {
  disabled: boolean;
  hasVoice: boolean;
  onChange: (voice: VoiceUpload) => void;
  onError: (message: string) => void;
  onRecordingChange: (recording: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef(0);
  const mountedRef = useRef(true);

  const release = () => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
  };
  const stop = () => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
  };
  useEffect(() => () => {
    mountedRef.current = false;
    recorderRef.current?.state === 'recording' && recorderRef.current.stop();
    release();
  }, []);

  const start = async () => {
    if (disabled || hasVoice || recording || processing) return;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      onError('Browser recording needs HTTPS and microphone permission. Use the audio-file button instead.');
      return;
    }
    try {
      onError('');
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      } catch (error) {
        const name = (error as DOMException).name;
        if (name !== 'OverconstrainedError' && name !== 'TypeError') throw error;
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;
      const canCheckType = typeof MediaRecorder.isTypeSupported === 'function';
      const mimeType = canCheckType
        ? ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type))
        : undefined;
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
      } catch {
        try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
        catch { recorder = new MediaRecorder(stream); }
      }
      const chunks: Blob[] = [];
      recorderRef.current = recorder;
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => { onError('Recording failed. Please try again.'); release(); setRecording(false); onRecordingChange(false); };
      recorder.onstop = async () => {
        const duration = Math.min(MAX_VOICE_DURATION_SECONDS, Math.max(1, Math.ceil((Date.now() - startedAtRef.current) / 1000)));
        release();
        if (!mountedRef.current) return;
        setRecording(false);
        onRecordingChange(false);
        setProcessing(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type || 'audio/webm' });
          if (!blob.size) throw new Error('No audio was captured. Check your microphone and try again.');
          if (blob.size > MAX_VOICE_BYTES) throw new Error('The recording is too large. Try a shorter voice message.');
          onChange({ dataUrl: await readDataUrl(blob), duration });
        } catch (error) { onError((error as Error).message); }
        finally { if (mountedRef.current) setProcessing(false); }
      };
      startedAtRef.current = Date.now();
      recorder.start(1000);
      setElapsed(0);
      setRecording(true);
      onRecordingChange(true);
      timerRef.current = setInterval(() => {
        const seconds = Math.floor((Date.now() - startedAtRef.current) / 1000);
        setElapsed(Math.min(seconds, MAX_VOICE_DURATION_SECONDS));
        if (seconds >= MAX_VOICE_DURATION_SECONDS) stop();
      }, 250);
    } catch (error) {
      release();
      recorderRef.current = null;
      setRecording(false);
      setProcessing(false);
      onRecordingChange(false);
      const name = (error as DOMException).name;
      onError(name === 'NotAllowedError' || name === 'SecurityError'
        ? 'Microphone access is blocked. Allow it in site settings, or use the audio-file button.'
        : name === 'NotFoundError'
          ? 'No microphone was found. Use the audio-file button to send a saved recording.'
          : name === 'NotReadableError' || name === 'AbortError'
            ? 'Your microphone is busy in another app. Close it there, or use the audio-file button.'
            : 'This browser could not start recording. Use the audio-file button instead.');
    }
  };

  const chooseAudio = async (file?: File) => {
    if (!file || disabled || hasVoice || recording || processing) return;
    const extension = file.name.split('.').pop()?.toLocaleLowerCase();
    const extensionType: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', mp3: 'audio/mpeg', ogg: 'audio/ogg', oga: 'audio/ogg', webm: 'audio/webm' };
    const mimeType = file.type === 'audio/x-m4a' ? 'audio/mp4'
      : file.type === 'audio/mp3' ? 'audio/mpeg'
      : file.type.split(';')[0] || extensionType[extension || ''];
    if (!CHAT_VOICE_TYPES.includes(mimeType)) { onError('Choose a WebM, M4A, MP4, OGG, or MP3 audio file.'); return; }
    if (!file.size || file.size > MAX_VOICE_BYTES) { onError('Choose an audio file smaller than 4 MB.'); return; }
    setProcessing(true);
    onError('');
    const objectUrl = URL.createObjectURL(file);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const audio = document.createElement('audio');
        const timeout = window.setTimeout(() => reject(new Error('The audio duration could not be read. Choose another file.')), 10000);
        audio.preload = 'metadata';
        audio.onloadedmetadata = () => { clearTimeout(timeout); resolve(audio.duration); };
        audio.onerror = () => { clearTimeout(timeout); reject(new Error('This audio file could not be opened.')); };
        audio.src = objectUrl;
      });
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('The audio duration could not be read. Choose another file.');
      if (duration > MAX_VOICE_DURATION_SECONDS + .25) throw new Error('Voice messages can be up to 3 minutes long.');
      const normalized = file.type === mimeType ? file : new File([file], file.name, { type: mimeType });
      onChange({ dataUrl: await readDataUrl(normalized), duration: Math.max(1, Math.ceil(duration)) });
    } catch (error) { onError((error as Error).message); }
    finally { URL.revokeObjectURL(objectUrl); if (mountedRef.current) setProcessing(false); }
  };

  if (recording) return <button type="button" onClick={stop} className="flex h-10 shrink-0 items-center gap-2 rounded-full bg-red-600 px-3 text-xs font-semibold text-white" aria-label="Stop voice recording">
    <Square className="h-3.5 w-3.5 fill-current" /> {formatDuration(elapsed)} / 3:00
  </button>;
  return <div className="flex shrink-0 items-center gap-1">
    <input ref={fileInputRef} type="file" accept="audio/webm,audio/mp4,audio/ogg,audio/mpeg,.m4a,.mp3" className="hidden" aria-label="Choose an audio recording"
      onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; void chooseAudio(file); }} />
    <button type="button" onClick={() => void start()} disabled={disabled || hasVoice || processing}
      className="chat-theme-outline flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
      aria-label="Record with microphone" title="Record with microphone">
      <Mic className="h-4 w-4" />
    </button>
    <button type="button" onClick={() => fileInputRef.current?.click()} disabled={disabled || hasVoice || processing}
      className="chat-theme-outline flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-stone-300 bg-stone-50 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300"
      aria-label={processing ? 'Preparing audio file' : 'Choose audio or use phone recorder'} title="Choose audio or use phone recorder">
      {processing ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileAudio className="h-4 w-4" />}
    </button>
  </div>;
}
