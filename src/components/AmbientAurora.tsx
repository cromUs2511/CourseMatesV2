import React, { useMemo } from 'react';

// Fixed geometry keeps the curtains stable across renders. Only their layers move.
const horizon = (x: number) => 245 + Math.sin(x / 155) * 64 + Math.sin(x / 78 + 1) * 22 + Math.sin(x / 33) * 7;
const points = Array.from({ length: 241 }, (_, index) => {
  const x = index * 6 - 120 + Math.sin(index * 2.3) * 2;
  return { x, y: horizon(x) };
});
const hem = points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
const curtain = `${hem} L 1320 -100 L -120 -100 Z`;

// Keep the vector artwork intact, but let the browser cache it as one image.
// Moving HTML image layers can be composited without repainting hundreds of SVG paths.
const rays = points.map(({ x, y }, index) => {
  const height = 130 + (Math.sin(index * 1.7) + 1) * 65;
  const width = 1.5 + (Math.sin(index * 2.3) + 1) * 2.5;
  return `<path opacity="${0.12 + (Math.sin(index * 0.8) + 1) * 0.18}"
    d="M ${x - 26} ${y - height} Q ${x - 8} ${y - 60} ${x} ${y} L ${x + width} ${y + 1} Q ${x + width - 8} ${y - 60} ${x + width - 26} ${y - height} Z"/>`;
}).join('');

function curtainImage(color: string) {
  const tint = /^#[0-9a-f]{6}$/i.test(color) ? color : '#6ee7b7';
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 640" preserveAspectRatio="none">
    <defs>
      <linearGradient id="veil" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#a78bfa" stop-opacity="0"/>
        <stop offset=".28" stop-color="#a78bfa" stop-opacity=".04"/>
        <stop offset=".58" stop-color="#67e8f9" stop-opacity=".16"/>
        <stop offset=".88" stop-color="${tint}" stop-opacity=".5"/>
        <stop offset="1" stop-color="#a7f3d0" stop-opacity=".12"/>
      </linearGradient>
      <linearGradient id="edge" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#67e8f9" stop-opacity="0"/>
        <stop offset=".2" stop-color="#67e8f9" stop-opacity=".65"/>
        <stop offset=".45" stop-color="${tint}"/>
        <stop offset=".65" stop-color="#a7f3d0" stop-opacity=".85"/>
        <stop offset=".85" stop-color="#a78bfa" stop-opacity=".5"/>
        <stop offset="1" stop-color="#a78bfa" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <path d="${curtain}" fill="url(#veil)" style="filter:blur(12px);opacity:.65"/>
    <g fill="url(#veil)" style="filter:blur(2px)">${rays}</g>
    <path d="${hem}" fill="none" stroke="url(#edge)" stroke-width="34" style="filter:blur(18px);opacity:.55"/>
    <path d="${hem}" fill="none" stroke="url(#edge)" stroke-width="2" style="filter:blur(2.5px);opacity:.65"/>
  </svg>`)}`;
}

export const AmbientAurora = React.memo(function AmbientAurora({ color }: { color: string }) {
  const image = useMemo(() => curtainImage(color), [color]);
  return (
    <div aria-hidden="true" className="ambient-aurora" style={{ '--aurora-color': color } as React.CSSProperties}>
      <div className="aurora-atmosphere" />
      <div className="aurora-sky">
        {['distant', 'near', 'echo'].map(layer => (
          <div key={layer} className={`aurora-curtain aurora-curtain-${layer}`}>
            <img src={image} alt="" draggable={false} decoding="async" />
          </div>
        ))}
      </div>
    </div>
  );
});
