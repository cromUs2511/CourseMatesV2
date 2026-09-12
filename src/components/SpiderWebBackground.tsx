import React, { useEffect, useRef } from 'react';

type WebState = 'shooting' | 'weaving' | 'fading';

interface AnimatedWeb {
  x: number;
  y: number;
  radialCount: number;
  maxRadius: number;
  radius: number;
  radialSpeed: number;
  alpha: number;
  state: WebState;
  driftX: number;
  driftY: number;
  weaveProgress: number;
  weaveSpeed: number;
}

function makeWeb(x: number, y: number, complete = false): AnimatedWeb {
  const maxRadius = Math.random() * 400 + 150;
  return {
    x,
    y,
    radialCount: Math.floor(Math.random() * 5) + 7,
    maxRadius,
    radius: complete ? maxRadius : 0,
    radialSpeed: Math.random() * 12 + 8,
    alpha: complete ? 0.72 : 1,
    state: complete ? 'fading' : 'shooting',
    driftX: (Math.random() - 0.5) * 0.4,
    driftY: (Math.random() - 0.5) * 0.4,
    weaveProgress: complete ? 1 : 0,
    weaveSpeed: Math.random() * 0.015 + 0.01,
  };
}

export const SpiderWebBackground = React.memo(function SpiderWebBackground({ isDarkMode }: { isDarkMode: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext('2d');
    if (!canvas || !context) return;

    let width = 0;
    let height = 0;
    let frame = 0;
    let webs: AnimatedWeb[] = [];
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    const resize = () => {
      const bounds = canvas.getBoundingClientRect();
      width = bounds.width;
      height = bounds.height;
      const scale = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
    };

    const draw = (web: AnimatedWeb) => {
      if (web.alpha <= 0) return;
      const ink = isDarkMode ? '255, 255, 255' : '17, 24, 39';
      context.strokeStyle = `rgba(${ink}, ${web.alpha * (isDarkMode ? 0.17 : 0.14)})`;
      context.lineWidth = 1;
      context.beginPath();
      for (let index = 0; index < web.radialCount; index += 1) {
        const angle = (index / web.radialCount) * Math.PI * 2;
        context.moveTo(web.x, web.y);
        context.lineTo(web.x + Math.cos(angle) * web.radius, web.y + Math.sin(angle) * web.radius);
      }
      context.stroke();

      if (web.state === 'shooting') {
        context.fillStyle = `rgba(${ink}, ${web.alpha * 0.8})`;
        for (let index = 0; index < web.radialCount; index += 1) {
          const angle = (index / web.radialCount) * Math.PI * 2;
          const x = web.x + Math.cos(angle) * web.radius;
          const y = web.y + Math.sin(angle) * web.radius;
          context.beginPath();
          context.arc(x, y, 1.5, 0, Math.PI * 2);
          context.fill();
        }
      }

      if (web.state !== 'shooting') {
        const loopSpacing = 25;
        const nodes = Math.floor(Math.floor(web.maxRadius / loopSpacing) * web.radialCount * web.weaveProgress);
        context.beginPath();
        for (let index = 0; index <= nodes; index += 1) {
          const loopIndex = Math.floor(index / web.radialCount);
          const radialIndex = index % web.radialCount;
          let radius = (loopIndex + radialIndex / web.radialCount) * loopSpacing + 15;
          radius += Math.sin(radialIndex * 4) * 2;
          if (radius > web.maxRadius) break;
          const angle = (radialIndex / web.radialCount) * Math.PI * 2;
          const x = web.x + Math.cos(angle) * radius;
          const y = web.y + Math.sin(angle) * radius;
          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }
        context.stroke();
      }
    };

    const update = (web: AnimatedWeb) => {
      web.x += web.driftX;
      web.y += web.driftY;
      if (web.state === 'shooting') {
        web.radius = Math.min(web.maxRadius, web.radius + web.radialSpeed);
        if (web.radius >= web.maxRadius) web.state = 'weaving';
      } else if (web.state === 'weaving') {
        web.weaveProgress = Math.min(1, web.weaveProgress + web.weaveSpeed);
        if (web.weaveProgress >= 1) web.state = 'fading';
      } else {
        web.alpha -= 0.002;
      }
    };

    const seed = (complete = false) => {
      webs = [
        makeWeb(width / 2, height / 2, complete),
        makeWeb(width * 0.2, height * 0.8, complete),
        makeWeb(width * 0.8, height * 0.2, complete),
      ];
    };

    const renderStatic = () => {
      context.clearRect(0, 0, width, height);
      seed(true);
      webs.forEach(draw);
    };

    const animate = () => {
      context.clearRect(0, 0, width, height);
      if (Math.random() < 0.02 && webs.length < 12) {
        webs.push(makeWeb(Math.random() * width * 1.5 - width * 0.25, Math.random() * height * 1.5 - height * 0.25));
      }
      webs.forEach(web => { update(web); draw(web); });
      webs = webs.filter(web => web.alpha > 0);
      frame = window.requestAnimationFrame(animate);
    };

    const start = () => {
      window.cancelAnimationFrame(frame);
      resize();
      if (reducedMotion.matches) renderStatic();
      else { seed(); frame = window.requestAnimationFrame(animate); }
    };

    start();
    window.addEventListener('resize', start);
    reducedMotion.addEventListener('change', start);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener('resize', start);
      reducedMotion.removeEventListener('change', start);
    };
  }, [isDarkMode]);

  return <canvas ref={canvasRef} className="ambient-spider-web" aria-hidden="true" />;
});
