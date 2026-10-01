# Mobile reading support — 2026-10-01

Owner asked to fix the support launcher covering Academy/Help text on phones.
Based on fresh production main b80d6d6c51c2729f43f080e44569a11c61b91ed1.
The integration/claude-codex ref returned 404. The only open PR was the separate
OTC #372; no file or commit from it is included here.

On reading pages at <=900px the support action now occupies an ordinary row
above the content. It uses the existing translated support label and existing
openSupportWidget event. A DOM-scoped CSS rule hides only the CLOSED floating
launcher while that replacement is rendered. Dialog actions and focus return,
Help's existing contact action and footer links remain. Desktop and non-reading
routes retain the global launcher; CSS does not persistently hide it after SPA
navigation. No global support component, article text, content routes, wallet,
backend, financial rule, dependency or infrastructure setting changes.

No added timers, API calls or storage. Explicitly opening the existing human
form may still perform its existing account-prefill read; this is not described
as zero traffic from every possible support interaction.

Local validation before publication: Chromium with the exact new CSS in an
isolated layout fixture, widths 320/360/390/430/768/900/901/1440, passed normal
flow, scrolling, width fit and route-marker removal. This is NOT a full-app QA.
The full-bundle CI checks guest and fixture-token pages, keyboard open/close,
focus return, breakpoint changes, SPA departure/back and virtual idle time.
Its current result and generated screenshots must be read before merge.
Real iOS/Safari, Android accessibility overrides and production browser QA are
not claimed. Local Git/download access failed DNS; connector reads/writes used.

The large canonical docs/AI_HANDOFF.md returned empty contents via fetch_file
and a too-large error via raw fetch; it was not overwritten. This scoped note
must be incorporated into the canonical handoff when its full bytes are safely
available. Preserve all newer notes and the open OTC work.
