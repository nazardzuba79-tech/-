# NRX price alignment after the ruler release

Base: main 3de491c05f2589044cca3435bbda3f04bc46d870, including #434 mobile and #435 ruler.
Source: Claude #436, exact head 4806157d85822e3d285d9f9c79e9a9e8e5bc71e0.

This integration copies the six non-handoff files of #436 byte-for-byte. It retains main's docs/AI_HANDOFF.md, including Codex's ruler handoff. It changes no OrderService, order route, balance, allocation, withdrawal, schema, UI, collector or deployment configuration. In particular it does NOT restore #427 and does NOT integrate #432.

#436 documents a difference between the live market-edge trajectory and the uninstalled expired v3 plan attached in main. This patch detaches that expired plan while retaining the reviewed plan constant, schedule engine and release gate. API and edge builds therefore share the same documented live-chart trajectory. It does not introduce a new listing time, new price schedule or history reset.

Source PR checks are not integration checks. Run exact-head CI for this branch before merge, including NRX PostgreSQL/browser, schedule release/parity and market-edge tests. No local repository or dependency installation is available in this session; local GitHub DNS resolution failed. Do not report local tests as passing.

The owner currently requests NRX sales through the existing Spot UI and existing test balances, not a separate user-facing demo account. That sale request is distinct from this price-only integration and remains unresolved here. No balance initialization, transfer, top-up or owner sale is authorized by this patch.

Hetzner rollout is separate from a GitHub merge and from Cloudflare Pages. The current session has no SSH executable, .ssh directory or SSH agent; the attempted public health read was inaccessible through the web tool. A Remote Desktop Commander connection was offered so the established authorized terminal can be used. No server version, production balance or completed sale was independently verified in this session.
