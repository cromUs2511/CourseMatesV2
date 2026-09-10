import React, { useEffect, useRef, useState } from 'react';
import { Camera, ImagePlus, LoaderCircle } from 'lucide-react';
import { MAX_CHAT_IMAGES, type ImageUpload } from '../data/chatImages';
import { prepareChatImage } from '../utils/prepareChatImage';
import { PhotoDialog } from './PhotoDialog';

function CameraCapture({ onCapture, accent, accentHover }: { onCapture: (file: File) => void; accent: string; accentHover: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    let disposed = false;
    let stream: MediaStream | undefined;
    mounted.current = true;
    const start = async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setError('Camera access needs HTTPS or localhost. You can still choose a photo from your device.');
        return;
      }
      try {
        const granted = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1600 } }, audio: false });
        if (disposed) { granted.getTracks().forEach(track => track.stop()); return; }
        stream = granted;
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      } catch (err) {
        if (disposed) return;
        stream?.getTracks().forEach(track => track.stop());
        const name = (err as DOMException).name;
        setError(name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera permission was not granted. Allow camera access in your browser’s site settings, or choose a photo instead.'
          : name === 'NotFoundError' ? 'No camera was found. Choose a photo from your device instead.'
          : 'The camera could not be opened. Close other apps using it, or choose a photo instead.');
      }
    };
    void start();
    return () => { disposed = true; mounted.current = false; stream?.getTracks().forEach(track => track.stop()); if (video.current) video.current.srcObject = null; };
  }, []);
  const capture = () => {
    const source = video.current;
    if (!source?.videoWidth || capturing) return;
    setCapturing(true);
    const canvas = document.createElement('canvas');
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    const context = canvas.getContext('2d');
    if (!context) { setError('Your browser could not capture this photo.'); setCapturing(false); return; }
    context.drawImage(source, 0, 0);
    canvas.toBlob(blob => {
      if (!mounted.current) return;
      if (blob) onCapture(new File([blob], 'Camera photo.jpg', { type: 'image/jpeg' }));
      else { setError('This photo could not be captured. Please try again.'); setCapturing(false); }
    }, 'image/jpeg', 0.9);
  };
  return <div className="space-y-3">
    {error ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p> : <>
      <video ref={video} autoPlay playsInline muted onLoadedData={() => setReady(true)} className="max-h-[45dvh] w-full rounded-xl bg-black object-contain" aria-label="Camera preview" />
      {!ready && <p role="status" className="text-xs text-stone-500">Waiting for camera access. Respond to your browser’s permission prompt.</p>}
      <button type="button" disabled={!ready || capturing} onClick={capture} style={{ backgroundColor: accent }} onMouseEnter={event => { event.currentTarget.style.backgroundColor = accentHover; }} onMouseLeave={event => { event.currentTarget.style.backgroundColor = accent; }} className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-white disabled:opacity-40"><Camera className="h-4 w-4" />Capture photo</button>
    </>}
  </div>;
}

export function ChatAttachments({ images, onChange, disabled, onError, onBusyChange, accent = '#991B1B', accentHover = '#7F1D1D' }: {
  images: ImageUpload[]; onChange: (images: ImageUpload[]) => void; disabled: boolean;
  onError: (message: string) => void; onBusyChange: (busy: boolean) => void; accent?: string; accentHover?: string;
}) {
  const [open, setOpen] = useState(false);
  const [camera, setCamera] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  useEffect(() => () => { generation.current += 1; }, []);
  useEffect(() => {
    if (disabled) { generation.current += 1; setOpen(false); setCamera(false); setBusy(false); onBusyChange(false); }
  }, [disabled, onBusyChange]);
  const choose = async (files: File[]) => {
    if (disabled || busy || !files.length) return;
    if (images.length + files.length > MAX_CHAT_IMAGES) { onError('Attach up to 4 photos per message.'); return; }
    const current = ++generation.current;
    setOpen(false); setCamera(false); setBusy(true); onBusyChange(true); onError('');
    try {
      // Prepare sequentially to keep phone memory use bounded.
      const prepared: ImageUpload[] = [];
      for (const file of files) {
        prepared.push(await prepareChatImage(file));
        if (generation.current !== current) return;
      }
      onChange([...images, ...prepared]);
    } catch (err) { if (generation.current === current) onError((err as Error).message); }
    finally { if (generation.current === current) { setBusy(false); onBusyChange(false); } }
  };
  const close = () => { setOpen(false); setCamera(false); };
  return <>
    <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" aria-label="Choose photos to attach"
      onChange={event => { const files = Array.from(event.target.files || []); event.target.value = ''; void choose(files); }} />
    <button type="button" aria-label="Attach photos" title="Attach photos" disabled={disabled || busy || images.length >= MAX_CHAT_IMAGES}
      onClick={() => setOpen(true)} className="chat-theme-outline flex h-10 w-10 shrink-0 items-center justify-center border border-stone-300 bg-stone-50 text-stone-600 disabled:opacity-40 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300">
      {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
    </button>
    {open && !disabled && <PhotoDialog title={camera ? 'Take a photo' : 'Attach photos'} onClose={close}>
      {camera ? <CameraCapture onCapture={file => void choose([file])} accent={accent} accentHover={accentHover} /> : <p className="mb-4 text-sm text-stone-500 dark:text-stone-400">Choose up to 4 photos. Preview them before sending.</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => fileInput.current?.click()} className="flex flex-1 items-center justify-center gap-2 border border-stone-300 px-4 py-3 text-sm dark:border-stone-700"><ImagePlus className="h-4 w-4" />Choose photos</button>
        {!camera && <button type="button" onClick={() => setCamera(true)} className="flex flex-1 items-center justify-center gap-2 border border-stone-300 px-4 py-3 text-sm dark:border-stone-700"><Camera className="h-4 w-4" />Take photo</button>}
      </div>
      <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">JPEG, PNG, or WebP · Up to 10 MB each. Camera access needs your browser’s permission.</p>
    </PhotoDialog>}
  </>;
}
