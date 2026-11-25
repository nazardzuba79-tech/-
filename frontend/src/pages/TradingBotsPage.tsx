import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { onSessionChange } from "../lib/api";
import { Nav } from "../components/Nav";
import styles from "./quant-marketplace/approved.css?raw";
import lightStage from "./quant-marketplace/light-stage.css?raw";
const Marketplace = lazy(() => import("./quant-marketplace/App"));
export function TradingBotsPage() {
  const [session, setSession] = useState(0);
  useEffect(() => onSessionChange(() => setSession((n) => n + 1)), []);
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (el) setShadow(el.shadowRoot ?? el.attachShadow({ mode: "open" }));
  }, []);
  return (
    <>
      <Nav active="/trading-bots" hideTicker />
      <div ref={attach} data-voltex-quant="">
        {shadow &&
          createPortal(
            <>
              <style>{styles}</style>
              <style>{lightStage}</style>
              <Suspense fallback={<p>Загрузка маркетплейса…</p>}>
                <Marketplace key={session} />
              </Suspense>
            </>,
            shadow,
          )}
      </div>
    </>
  );
}
