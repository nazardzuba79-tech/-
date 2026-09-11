import { ReactNode, useEffect, useRef } from 'react';

/** One observer pauses CSS decoration outside the viewport and in background tabs. */
export function MotionStage({ children, className = '', tilt = false }: {
  children: ReactNode; className?: string; tilt?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let visible = false;
    const sync = () => el.classList.toggle('vx-motion-active', visible && !document.hidden);
    const observer = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); });
    if (observer) observer.observe(el);
    else { visible = true; sync(); }
    document.addEventListener('visibilitychange', sync);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    let frame = 0;
    let x = 0, y = 0;
    const reset = () => {
      cancelAnimationFrame(frame); frame = 0;
      el.style.removeProperty('--vx-tilt-x'); el.style.removeProperty('--vx-tilt-y');
      el.style.removeProperty('--vx-light-x'); el.style.removeProperty('--vx-light-y');
    };
    const move = (event: PointerEvent) => {
      if (!tilt || motion.matches || !finePointer.matches || !visible) return;
      const box = el.getBoundingClientRect();
      x = Math.max(-.5, Math.min(.5, (event.clientX - box.left) / box.width - .5));
      y = Math.max(-.5, Math.min(.5, (event.clientY - box.top) / box.height - .5));
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0;
        el.style.setProperty('--vx-tilt-x', `${-y * 3}deg`);
        el.style.setProperty('--vx-tilt-y', `${x * 4}deg`);
        el.style.setProperty('--vx-light-x', `${x * 6}px`);
        el.style.setProperty('--vx-light-y', `${y * 4}px`);
      });
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerleave', reset);
    motion.addEventListener('change', reset);
    return () => {
      observer?.disconnect(); document.removeEventListener('visibilitychange', sync);
      el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', reset);
      motion.removeEventListener('change', reset); reset();
    };
  }, [tilt]);
  return <div ref={ref} className={`vx-motion-stage ${className}`}>{children}</div>;
}
