# Hetzner NRX hotfix — 2026-10-05

Base: live production backend 7cb2ac057beb31d3e934f265e89f3345cdc8865d.
Purpose: restore owner/admin NRX/USDT MARKET SELL against explicit simulation:NRX counterparty while keeping the existing ordinary Spot ledger, and align the API NRX simulation with the market-edge wave structure already deployed by 8de2398134e862d25f8af8a255c8e5108b524246.

This hotfix intentionally does NOT port current main wholesale. package.json, package-lock.json and prisma/schema.prisma remain byte-identical to the live base. No migration is required. It preserves the existing Docker/runtime launcher and database.

Runtime changes:
- OrderService: ADMIN + NRX/USDT + MARKET SELL fills immediately at canonical NRX simulation price, debits ordinary Spot NRX and credits ordinary Spot USDT atomically, records FILLED Order/Trade/Audit with counterparty simulation:NRX.
- NRX market structure: port the already-deployed market-edge wave implementation so API price matches the public NRX chart path.
- Ordinary users, other pairs, BUY/LIMIT/conditional behavior remain unchanged.

No allocation/reset/top-up is part of this hotfix.
