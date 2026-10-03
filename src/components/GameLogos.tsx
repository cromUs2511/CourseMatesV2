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

export const RockPaperScissorsLogo: React.FC<{ className?: string }> = ({
  className = 'h-9 w-9',
}) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="22" fill="#1C1917" />
    <g stroke="#FFFFFF" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 34 Q14 22 24 22 Q34 22 34 34" opacity="0.3" />
      <path d="M14 34 Q14 22 24 22 Q34 22 34 34" />
    </g>
    <g transform="translate(10, 10) scale(0.6)">
      <circle cx="8" cy="20" r="6" fill="#E11D34" />
      <rect x="20" y="14" width="8" height="12" rx="2" fill="#3B82F6" />
      <path
        d="M34 20 L30 20 L32 14 L34 20 L36 14 L32 20 L38 20"
        stroke="#22C55E"
        strokeWidth="2"
        fill="none"
      />
    </g>
  </svg>
);

export const ConnectFourLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <rect x="3" y="3" width="42" height="42" rx="9" fill="#1C1917" />
    <g>
      <circle cx="15" cy="15" r="5" fill="#FCA5A5" />
      <circle cx="33" cy="15" r="5" fill="#FDE047" />
      <circle cx="15" cy="33" r="5" fill="#FCA5A5" />
      <circle cx="33" cy="33" r="5" fill="#FDE047" />
      <circle cx="24" cy="15" r="5" fill="#FCA5A5" />
      <circle cx="24" cy="33" r="5" fill="#FDE047" />
    </g>
    <circle cx="24" cy="24" r="5" fill="#FCA5A5" opacity="0.5" />
    <path d="M24 19 L24 29" stroke="#FFFFFF" strokeWidth="2" strokeLinecap="round" opacity="0.8" />
  </svg>
);

export const ChessLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <rect x="2" y="2" width="44" height="44" rx="11" fill="#1C1917" />
    <rect x="8" y="8" width="32" height="32" fill="none" stroke="#FFFFFF" strokeWidth="1.5" />
    <g stroke="#FFFFFF" strokeWidth="1" opacity="0.3">
      <line x1="16" y1="8" x2="16" y2="40" />
      <line x1="24" y1="8" x2="24" y2="40" />
      <line x1="32" y1="8" x2="32" y2="40" />
      <line x1="8" y1="16" x2="40" y2="16" />
      <line x1="8" y1="24" x2="40" y2="24" />
      <line x1="8" y1="32" x2="40" y2="32" />
    </g>
    <g>
      <path d="M24 14 L22 18 L26 18 Z" fill="#FFFFFF" />
      <rect x="21" y="18" width="6" height="6" fill="#FFFFFF" />
      <rect x="20" y="24" width="8" height="4" fill="#FFFFFF" />
      <ellipse cx="24" cy="32" rx="6" ry="4" fill="#E11D34" />
    </g>
  </svg>
);

export const TriviaLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="22" fill="#1C1917" />
    <text
      x="24"
      y="30"
      textAnchor="middle"
      fontSize="28"
      fontWeight="900"
      fill="#F59E0B"
      fontFamily="ui-sans-serif, system-ui, sans-serif"
    >
      ?
    </text>
    <g stroke="#FFFFFF" strokeWidth="1.5" fill="none" opacity="0.3">
      <circle cx="24" cy="24" r="12" />
      <path d="M18 30 Q24 24 30 30" />
    </g>
  </svg>
);

export const WouldYouRatherLogo: React.FC<{ className?: string }> = ({ className = 'h-9 w-9' }) => (
  <svg viewBox="0 0 48 48" className={`shrink-0 ${className}`} aria-hidden="true" focusable="false">
    <circle cx="24" cy="24" r="22" fill="#1C1917" />
    <g fill="#FFFFFF">
      <circle cx="16" cy="24" r="7" />
      <circle cx="32" cy="24" r="7" />
    </g>
    <g fill="#1C1917">
      <circle cx="16" cy="24" r="3" />
      <circle cx="32" cy="24" r="3" />
    </g>
    <path
      d="M16 30 Q24 24 32 30"
      stroke="#F59E0B"
      strokeWidth="2.5"
      fill="none"
      strokeLinecap="round"
    />
  </svg>
);
