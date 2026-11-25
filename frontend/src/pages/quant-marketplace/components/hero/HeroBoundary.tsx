import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import type { ThemeMode } from "./QuantHeroVisual";
export type { ThemeMode };
const Scene = lazy(() =>
  import("./QuantHeroVisual").then((m) => ({ default: m.QuantHeroVisual })),
);
export function HeroBoundary({
  theme,
  onSelectMarket,
}: {
  theme: ThemeMode;
  onSelectMarket?: (symbol: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    let visible = false;
    const sync = () => setActive(visible && !document.hidden && !media.matches);
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    observer.observe(ref.current!);
    document.addEventListener("visibilitychange", sync);
    media.addEventListener("change", sync);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", sync);
      media.removeEventListener("change", sync);
    };
  }, []);
  return (
    <div
      ref={ref}
      className="quant-hero-stage"
      style={{
        backgroundImage: "url(/quant-marketplace/hero-" + theme + ".webp)",
      }}
    >
      {active && (
        <Suspense fallback={null}>
          <Scene theme={theme} onSelectMarket={onSelectMarket} />
        </Suspense>
      )}
    </div>
  );
}
