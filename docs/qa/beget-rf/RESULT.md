# Beget RF gateway — SECURITY HOLD / NO-GO

The owner changed the security requirements before completion. The former L7
TLS-terminating architecture does not satisfy them and was not accepted.

Actual Beget closure, DNS withdrawal, evidence, data visibility, TLS passthrough
proposal, provider/legal limitations and release blockers are documented in
[SECURITY_REVIEW.md](SECURITY_REVIEW.md).

- Beget port 443 closed; every HTTP route 503; no frontend, JS or private upstream.
- Old activation scripts quarantined and disabled in review code.
- ru A removed, no AAAA, ru-only CAA deny issuance, public DNS verified.
- Existing inactive ru certificate still requires remediation before reopening.
- Main site rendered desktop/mobile; primary API healthy at unchanged 89c3ac003b44a6a0e7630d2ecbe5d7164e85b683.
- Targeted offline security tests 7/7; renderer tests 5/5. No financial/load/full CI rerun.
- Provider-policy, legal clearance and an independent trusted TLS endpoint remain BLOCKED.

Earlier commits contain historical preflight/purchase reports. Their pending DNS,
package-installation and activation claims are superseded by this report.
No merge, main deploy, Hetzner/PG/financial change or new purchase in this phase.
