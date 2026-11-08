import { useEffect, useRef } from 'react';
import { useMotionReduced } from '../lib/prefs';

export interface Star {
  x: number; // 0–1
  y: number; // 0–1
  r: number; // px
  phase: number; // radians
  speed: number; // twinkle rate
}

/** Deterministic star positions (mulberry32), so the sky is the same on every visit. */
export function makeStars(count: number, seed = 7): Star[] {
  let a = seed >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: count }, () => ({
    x: rand(),
    y: rand(),
    r: 0.4 + rand() * 1.2,
    phase: rand() * Math.PI * 2,
    speed: 0.4 + rand() * 1.1,
  }));
}

function draw(ctx: CanvasRenderingContext2D, stars: Star[], w: number, h: number, t: number) {
  ctx.clearRect(0, 0, w, h);
  for (const s of stars) {
    const twinkle = t === 0 ? 0.75 : 0.55 + 0.45 * Math.sin(s.phase + t * s.speed);
    ctx.globalAlpha = twinkle;
    ctx.fillStyle = s.r > 1.3 ? '#cdf6ff' : '#e8ecf8';
    ctx.beginPath();
    ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/**
 * Background starfield (Home and Brain). A single static frame when reduced motion is requested
 * (OS setting, Reduce motion, or low-stimulation); otherwise a slow twinkle. Purely decorative.
 */
export function Starfield({ count = 140, className = '' }: { count?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useMotionReduced();

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const stars = makeStars(count);
    let frame = 0;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (reduced) draw(ctx, stars, w, h, 0);
    };
    resize();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    ro?.observe(canvas);

    if (!reduced) {
      const loop = (ms: number) => {
        draw(ctx, stars, w, h, ms / 1000);
        frame = requestAnimationFrame(loop);
      };
      frame = requestAnimationFrame(loop);
    }
    return () => {
      cancelAnimationFrame(frame);
      ro?.disconnect();
    };
  }, [count, reduced]);

  return (
    <canvas
      ref={ref}
      data-testid="starfield"
      data-animated={reduced ? 'false' : 'true'}
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full opacity-60 ${className}`}
    />
  );
}
