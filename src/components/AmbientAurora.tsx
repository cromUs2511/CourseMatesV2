import React, { useId } from 'react';

// Fixed geometry keeps the curtains stable across renders. Only their layers move.
const horizon = (x: number) => 245 + Math.sin(x / 155) * 64 + Math.sin(x / 78 + 1) * 22 + Math.sin(x / 33) * 7;
const points = Array.from({ length: 241 }, (_, index) => {
  const x = index * 6 - 120 + Math.sin(index * 2.3) * 2;
  return { x, y: horizon(x) };
});
const hem = points.map(({ x, y }, index) => `${index ? 'L' : 'M'} ${x} ${y}`).join(' ');
const curtain = `${hem} L 1320 -100 L -120 -100 Z`;

export function AmbientAurora({ color }: { color: string }) {
  const id = useId().replace(/:/g, '');
  const fill = `url(#${id}-veil)`;
  const edge = `url(#${id}-edge)`;

  return (
    <div aria-hidden="true" className="ambient-aurora" style={{ '--aurora-color': color } as React.CSSProperties}>
      <div className="aurora-atmosphere" />
      <svg className="aurora-sky" viewBox="0 0 1200 640" preserveAspectRatio="none" focusable="false">
        <defs>
          <linearGradient id={`${id}-veil`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#a78bfa" stopOpacity="0" />
            <stop offset="0.28" stopColor="#a78bfa" stopOpacity="0.04" />
            <stop offset="0.58" stopColor="#67e8f9" stopOpacity="0.16" />
            <stop offset="0.88" stopColor="var(--aurora-color)" stopOpacity="0.5" />
            <stop offset="1" stopColor="#a7f3d0" stopOpacity="0.12" />
          </linearGradient>
          <linearGradient id={`${id}-edge`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#67e8f9" stopOpacity="0" />
            <stop offset="0.2" stopColor="#67e8f9" stopOpacity="0.65" />
            <stop offset="0.45" stopColor="var(--aurora-color)" />
            <stop offset="0.65" stopColor="#a7f3d0" stopOpacity="0.85" />
            <stop offset="0.85" stopColor="#a78bfa" stopOpacity="0.5" />
            <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
          </linearGradient>
          <g id={`${id}-curtain`}>
            <path className="aurora-veil" d={curtain} fill={fill} />
            <g className="aurora-rays" fill={fill}>
              {points.map(({ x, y }, index) => {
                const height = 130 + (Math.sin(index * 1.7) + 1) * 65;
                const width = 1.5 + (Math.sin(index * 2.3) + 1) * 2.5;
                return <path key={index} opacity={0.12 + (Math.sin(index * 0.8) + 1) * 0.18}
                  d={`M ${x - 26} ${y - height} Q ${x - 8} ${y - 60} ${x} ${y} L ${x + width} ${y + 1} Q ${x + width - 8} ${y - 60} ${x + width - 26} ${y - height} Z`} />;
              })}
            </g>
            <path className="aurora-bloom" d={hem} fill="none" stroke={edge} strokeWidth="34" />
            <path className="aurora-hem" d={hem} fill="none" stroke={edge} strokeWidth="2" />
          </g>
        </defs>
        <g className="aurora-curtain aurora-curtain-distant"><use href={`#${id}-curtain`} /></g>
        <g className="aurora-curtain aurora-curtain-near"><use href={`#${id}-curtain`} /></g>
        <g className="aurora-curtain aurora-curtain-echo"><use href={`#${id}-curtain`} /></g>
      </svg>
    </div>
  );
}
