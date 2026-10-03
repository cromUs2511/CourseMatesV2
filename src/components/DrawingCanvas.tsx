import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { DrawGuessAction, DrawPoint, DrawStroke } from '../data/drawGuess';

type StrokeAction = Extract<DrawGuessAction, { action: 'stroke' }>;
type Gesture = {
  pointerId: number;
  stroke: DrawStroke;
  offset: number;
  version: number;
  ended: boolean;
  failed: boolean;
  flight: Promise<void> | null;
};
export function DrawingCanvas({
  strokes,
  canvasVersion,
  enabled,
  color,
  width,
  eraser,
  onBatch,
  onSyncChange,
}: {
  strokes: DrawStroke[];
  canvasVersion: number;
  enabled: boolean;
  color: string;
  width: number;
  eraser: boolean;
  onBatch: (batch: Omit<StrokeAction, 'action' | 'gameId' | 'round'>) => Promise<void>;
  onSyncChange: (syncing: boolean) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [local, setLocal] = useState<DrawStroke | null>(null);
  const callbacks = useRef({ onBatch, onSyncChange });
  callbacks.current = { onBatch, onSyncChange };
  const layers = useRef({ strokes, local });
  layers.current = { strokes, local };
  const paint = useCallback(() => {
    const el = canvas.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(rect.width * ratio)),
      h = Math.max(1, Math.round(rect.height * ratio));
    if (el.width !== w || el.height !== h) {
      el.width = w;
      el.height = h;
    }
    const ctx = el.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(w / 800, 0, 0, h / 500, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 800, 500);
    const render = (stroke: DrawStroke) => {
      const first = stroke.points[0];
      if (!first) return;
      ctx.strokeStyle = ctx.fillStyle = stroke.eraser ? '#ffffff' : stroke.color;
      ctx.lineWidth = stroke.width * (stroke.eraser ? 3 : 1);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.arc(first.x * 800, first.y * 500, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fill();
      if (stroke.points.length > 1) {
        ctx.beginPath();
        ctx.moveTo(first.x * 800, first.y * 500);
        for (const p of stroke.points.slice(1)) ctx.lineTo(p.x * 800, p.y * 500);
        ctx.stroke();
      }
    };
    for (const s of layers.current.strokes) render(s);
    if (layers.current.local) render(layers.current.local);
  }, []);
  useEffect(paint, [paint, strokes, local]);
  useEffect(() => {
    const observer = new ResizeObserver(paint);
    if (canvas.current) observer.observe(canvas.current);
    return () => observer.disconnect();
  }, [paint]);
  const reset = useCallback(() => {
    const g = gesture.current;
    if (g && canvas.current?.hasPointerCapture(g.pointerId))
      canvas.current.releasePointerCapture(g.pointerId);
    gesture.current = null;
    setLocal(null);
    callbacks.current.onSyncChange(false);
  }, []);
  useEffect(() => {
    reset();
  }, [canvasVersion, enabled, reset]);
  useEffect(
    () => () => {
      gesture.current = null;
    },
    [],
  );
  const flush = useCallback(
    (g: Gesture): Promise<void> => {
      if (g.flight) return g.flight;
      if (g.failed || gesture.current !== g || g.offset >= g.stroke.points.length)
        return Promise.resolve();
      const points = g.stroke.points.slice(g.offset, g.offset + 64),
        offset = g.offset;
      g.flight = callbacks.current
        .onBatch({
          canvasVersion: g.version,
          strokeId: g.stroke.id,
          offset,
          color: g.stroke.color,
          width: g.stroke.width,
          eraser: g.stroke.eraser,
          points,
        })
        .then(() => {
          g.offset = offset + points.length;
        })
        .catch(() => {
          // Parent reports the error. Drop the local preview and recover from server state.
          g.failed = true;
          if (gesture.current === g) reset();
        })
        .finally(() => {
          g.flight = null;
        });
      return g.flight;
    },
    [reset],
  );
  useEffect(() => {
    const timer = window.setInterval(() => {
      const g = gesture.current;
      if (g && !g.ended) void flush(g);
    }, 250);
    return () => window.clearInterval(timer);
  }, [flush]);
  const point = (e: PointerEvent<HTMLCanvasElement>): DrawPoint => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };
  const preview = (g: Gesture) => setLocal({ ...g.stroke, points: [...g.stroke.points] });
  const end = async (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId || g.ended) return;
    g.ended = true;
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    while (!g.failed && gesture.current === g && g.offset < g.stroke.points.length) await flush(g);
    if (gesture.current === g) reset();
  };
  return (
    <canvas
      ref={canvas}
      className={`draw-canvas ${enabled ? 'draw-canvas-active' : ''}`}
      role="img"
      aria-label="Drawing canvas"
      data-stroke-count={strokes.length}
      onPointerDown={(e) => {
        if (!enabled || gesture.current || !e.isPrimary || e.button !== 0) return;
        e.preventDefault();
        const g: Gesture = {
          pointerId: e.pointerId,
          stroke: { id: crypto.randomUUID(), color, width, eraser, points: [point(e)] },
          offset: 0,
          version: canvasVersion,
          ended: false,
          failed: false,
          flight: null,
        };
        gesture.current = g;
        preview(g);
        callbacks.current.onSyncChange(true);
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* Synthetic events do not have active pointers. */
        }
      }}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId || g.ended || g.stroke.points.length >= 2048) return;
        const p = point(e),
          previous = g.stroke.points.at(-1)!;
        if (Math.hypot((p.x - previous.x) * 800, (p.y - previous.y) * 500) < 2) return;
        g.stroke.points.push(p);
        preview(g);
      }}
      onPointerUp={(e) => void end(e)}
      onPointerCancel={(e) => void end(e)}
      onLostPointerCapture={(e) => void end(e)}
    />
  );
}
