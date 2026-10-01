# Admin Users: deposit address copy bell

Base: `46456d61b6114dbd8edb80fdc3a5e962053f4f15`.

The owner showed the Users table after copying a deposit address from another account. A read-only production metadata check confirmed that the copy was already recorded; the Users screen did not render journal events. No payment or balance was changed during diagnosis.

The existing authenticated/admin-only users response now includes each returned customer's latest copy (coin, network, server receipt time, optional untrusted device time). One additional parameterized SELECT uses a lateral latest-row lookup over the existing user/time index. It returns at most one row per requested user and skips the query for an empty user list. No new endpoint, schema migration, request from the browser, polling, watcher, write or matching operation is added. A journal read failure is explicitly unknown and does not hide the users/balances.

A compact gold bell next to Balance appears on desktop and mobile. Clicking it expands the network/date/time locally without navigating the parent row. It links to the existing copy journal and unattributed deposits queue. The copy is never labelled as payment or credit. Old events remain available beyond an hour. Existing balance display, credit eligibility/drawer, account actions and refresh cadence are preserved. The bell uses the snapshot from the existing users read: re-open the Users page or reload to see new copies. It is not real-time.

New tests: nine backend query/authorization/resilience cases and nine rendered frontend/date/session-key/wiring cases. The targeted CI job also runs the existing admin users, customers and activity regressions. CI status on the exact head is authoritative; no claim of local execution (this environment cannot fetch npm dependencies). Existing financial tests run only on isolated fixture data. No real-money test is required or permitted.

The previous journal and initiating-session copy guard from Claude/Codex are untouched. OTC work, Trading Tools, deposit minimum and public-facing UI are unchanged. This note supplements the existing handoff without replacing concurrent handoff entries.
