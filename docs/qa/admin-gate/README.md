# /admin access gate and Users loading states — browser evidence

Produced by `scripts/qa-admin-gate.cjs` on the production bundle (`frontend/dist`) against a local fixture API. Every account, email and amount is synthetic. Nothing ran against Render, Neon or production.

| Scenario (390 and 1440 px) | Expected | Screenshot |
| --- | --- | --- |
| success | Users page; 0 admin requests before `/me` confirmed ADMIN | `success-*.png` |
| 401 / 403 from `/me` | leaves `/admin`; no admin request | — |
| 503, network error, malformed `/me` | stays on `/admin` with «Не удалось проверить доступ» + «Повторить»; exactly one `/me` (no hidden retry loop); retry recovers | `error-503-*.png`, `error-network-*.png`, `error-malformed-*.png` |
| hung `/me` | «Проверяем доступ…», «дольше обычного» at 5 s, aborted at 15 s (TIMEOUT), retry recovers; the hung connection is closed | `checking-*.png`, `checking-slow-*.png`, `error-timeout-*.png` |
| first activity read fails | «Загрузка…» ends; ready count «—», per-row «…», no «Нет пополнений»; «Повторить» = exactly one new request | `activity-failed-*.png` |
| activity fails after a good read (clock +1 h, the normal hourly re-read) | data kept, «Не удалось обновить… Показаны данные на HH:MM» | `activity-stale-*.png` |
| session revoked (a privileged read answers 401) | token cleared, `/admin` left | — |
| token replaced by a customer account + reload | refused; no further admin reads | — |

Result: `report.json` — 22/22 PASS; three consecutive local runs gave the same result.

Not measured here: the production slowdown. These fixes remove the empty screen and the false redirect; they are not claimed as the cause of any production latency.
