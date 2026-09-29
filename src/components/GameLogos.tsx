import React from 'react';

/** Marks are decorative: the tile beside them already names the game. */

export const UnoLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 44 60" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <rect
      x="2"
      y="2"
      width="40"
      height="56"
      rx="9"
      fill="#D7263D"
      stroke="#1C1917"
      strokeWidth="2"
    />
    <rect
      x="6.5"
      y="6.5"
      width="31"
      height="47"
      rx="6"
      fill="none"
      stroke="#FFFFFF"
      strokeWidth="2.5"
    />
    <g transform="rotate(-20 22 30)">
      <ellipse cx="22" cy="30" rx="14.5" ry="9.5" fill="#FFFFFF" />
      <text
        x="22"
        y="34"
        textAnchor="middle"
        fontSize="11"
        fontWeight="900"
        fontStyle="italic"
        letterSpacing="-0.8"
        fill="#1C1917"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        UNO
      </text>
    </g>
  </svg>
);

export const TicTacToeLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <rect
      x="2"
      y="2"
      width="44"
      height="44"
      rx="11"
      fill="#1C1917"
      stroke="#1C1917"
      strokeWidth="2"
    />
    <g stroke="#FFFFFF" strokeWidth="2.6" strokeLinecap="round" opacity="0.92">
      <line x1="18" y1="11" x2="18" y2="37" />
      <line x1="30" y1="11" x2="30" y2="37" />
      <line x1="11" y1="18" x2="37" y2="18" />
      <line x1="11" y1="30" x2="37" y2="30" />
    </g>
    <g stroke="#E11D34" strokeWidth="2.6" strokeLinecap="round">
      <line x1="11.2" y1="11.2" x2="16.8" y2="16.8" />
      <line x1="16.8" y1="11.2" x2="11.2" y2="16.8" />
    </g>
    <circle cx="34" cy="34" r="3.4" fill="none" stroke="#F59E0B" strokeWidth="2.6" />
  </svg>
);
