import { lazy, Suspense, useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import type { QuantPresentation } from "../../../src/shared/quantPresentation";
import { ApiError, onSessionChange, request } from "../lib/api";
import { Nav } from "../components/Nav";
import styles from "./quant-marketplace/approved.css?raw";
import thomasProfile from "./quant-marketplace/thomas-profile.css?raw";
import lightStage from "./quant-marketplace/light-stage.css?raw";
const Marketplace = lazy(() => import("./quant-marketplace/App"));
function ClosedPresentation() {
  const [data, setData] = useState<QuantPresentation | null>(null);
  const [status, setStatus] = useState("Проверяем приглашение…");
  useEffect(() => {
    const ctrl = new AbortController();
    request<QuantPresentation>("/trading-bots/presentation", { signal: ctrl.signal, cache: "no-store" })
      .then(response => {
        if (response.source !== "presentation" || response.monthlyReturns?.length !== 24 ||
            !response.monthlyReturns.every(Number.isFinite) || !Number.isFinite(response.exampleWinRate))
          throw Error("Invalid presentation");
        if (!ctrl.signal.aborted) setData(response);
      }).catch(error => {
        if (!ctrl.signal.aborted) setStatus(error instanceof ApiError && [401, 403].includes(error.status)
          ? "Просмотр доступен только по приглашению." : "Презентация временно недоступна.");
      });
    return () => ctrl.abort();
  }, []);
  return data ? <Marketplace presentation={data} /> : <p role="status">{status}</p>;
}
export function TradingBotsPage() {
  const location = useLocation();
  const privateView = location.pathname.split("/")[2] === "presentation";
  // Static visual-review scenario only on this isolated Pages preview hostname.
  // No API entitlement, subscription, trade or user-specific data is bypassed.
  const visualReview =
    privateView &&
    window.location.hostname === "codex-thomas-ai-pulse.voltex-exchange.pages.dev" &&
    new URLSearchParams(location.search).get("visualReview") === "thomas";
  const visualScenario: QuantPresentation = {
    source: "presentation",
    monthlyReturns: [...Array<number>(23).fill(306), 310],
    exampleWinRate: 97.1,
  };
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
              <style>{thomasProfile}</style>
              <Suspense fallback={<p>Загрузка маркетплейса…</p>}>
                {privateView
                  ? visualReview
                    ? <Marketplace key={session} presentation={visualScenario} />
                    : <ClosedPresentation key={session} />
                  : <Marketplace key={session} />}
              </Suspense>
            </>,
            shadow,
          )}
      </div>
    </>
  );
}
