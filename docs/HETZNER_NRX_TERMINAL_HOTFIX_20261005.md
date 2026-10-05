# Hetzner NRX terminal hotfix — 2026-10-05

Base: production backend hotfix 48a96235d8ff57f321f5e61b7c2372e6c375b880.
Source scenario: merged main d1c7673ca403751423643b39cae420a6182f919c / PR #442.

Runtime delta is intentionally limited to the shared NRX simulation/schedule files needed for:
growth stop -> 48h balance -> 6h -60% selloff -> balance forever.

package.json, package-lock.json, prisma/schema.prisma, OrderService, Docker/runtime and DB configuration remain byte-identical to the already deployed production base.
No migration, allocation, balance reset, listing reset or historical rewrite is part of this hotfix.

Activation: 2026-10-05T10:00:00Z (13:00 Kyiv). Both API and market-edge must carry the same schedule before activation. If that window is missed, do not backdate: move activation and dependent phase times forward and rebuild/reverify.
