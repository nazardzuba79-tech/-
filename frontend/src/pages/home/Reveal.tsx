import { ReactNode, useEffect, useRef, useState } from 'react';

/**
 * One-time reveal for a below-the-fold section: opacity plus ~14px of
 * lift, 550ms, then the observer disconnects so it never replays on
 * scroll-back. Wraps whole sections deliberately — animating table rows
 * individually would turn a market list into a light show.
 *
 * Motion itself is switched off under prefers-reduced-motion in home.css;
 * the shown state still applies, so content is never left invisible.
 */
export function Reveal({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // No IntersectionObserver (very old browser, or a test environment):
    // show immediately rather than leaving the section hidden forever.
    if (typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={ref} className={`vx-reveal ${shown ? 'vx-shown' : ''}`}>
      {children}
    </div>
  );
}
