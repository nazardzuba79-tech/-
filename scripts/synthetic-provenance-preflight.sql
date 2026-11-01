-- #630 provenance quarantine — READ-ONLY operator preflight (aggregates only: no User.id, email or amounts per account).
-- Run as:  psql "$DSN" -v ON_ERROR_STOP=1 -c 'BEGIN TRANSACTION READ ONLY' -c "SET LOCAL statement_timeout='3s'" -f this.sql -c 'ROLLBACK'
-- Identified accounts are exactly those with a Balance-settled simulation-sale receipt of a non-valued asset (S > 0);
-- each is UNVERIFIED (on hold) until an admin SYNTHETIC_PROVENANCE_DECISION releases it to the floor.
WITH receipts AS (
  SELECT "userId", "createdAt", metadata
  FROM "AuditLog"
  WHERE action IN ('NRX_SIMULATION_SOLD', 'TEAM_SPOT_SIMULATION_SOLD') AND "userId" IS NOT NULL
    AND COALESCE(metadata->>'settlementLedger', 'Balance') <> 'DemoBalance'
), identified AS (
  SELECT "userId", MIN("createdAt") AS first_sale,
         bool_or(split_part(metadata->>'pair', '/', 3) <> '' OR split_part(metadata->>'pair', '/', 2) = ''
                 OR NOT (metadata->>'proceeds' ~ '^[0-9]+(\.[0-9]+)?$')) AS malformed
  FROM receipts
  WHERE split_part(metadata->>'pair', '/', 2) = 'USDT'
    AND NOT (split_part(metadata->>'pair', '/', 1) = ANY (ARRAY['USDT','USDC','BTC','ETH']))
  GROUP BY "userId"
), contacts AS (
  -- Every completed Spot trade between an identified account and another real account after its first synthetic sale.
  SELECT CASE WHEN t."takerUserId" = i."userId" THEN t."makerUserId" ELSE t."takerUserId" END AS counterparty,
         MIN(t."executedAt") AS first_contact,
         bool_or((t."takerUserId" = i."userId" AND t.side = 'BUY') OR (t."makerUserId" = i."userId" AND t.side = 'SELL')) AS identified_paid_quote
  FROM "Trade" t JOIN identified i ON i."userId" IN (t."takerUserId", t."makerUserId")
  WHERE t."executedAt" >= i.first_sale AND t."takerUserId" NOT LIKE 'simulation:%' AND t."makerUserId" NOT LIKE 'simulation:%'
    AND t."takerUserId" <> t."makerUserId"
  GROUP BY 1
), latest AS (
  -- Same rule as the server: an unreadable decision row (seq or decision) wins and counts as QUARANTINE.
  SELECT DISTINCT ON ("userId") "userId",
         CASE WHEN COALESCE(metadata->>'seq', '') ~ '^[1-9][0-9]{0,15}$' AND metadata->>'decision' IN ('QUARANTINE', 'RELEASE_TO_FLOOR')
              THEN metadata->>'decision' ELSE 'QUARANTINE' END AS decision
  FROM "AuditLog" WHERE action = 'SYNTHETIC_PROVENANCE_DECISION' AND "userId" IN (SELECT "userId" FROM identified)
  ORDER BY "userId",
           CASE WHEN COALESCE(metadata->>'seq', '') ~ '^[1-9][0-9]{0,15}$' AND metadata->>'decision' IN ('QUARANTINE', 'RELEASE_TO_FLOOR')
                THEN (metadata->>'seq')::bigint ELSE 9223372036854775807 END DESC
)
SELECT
  (SELECT count(*) FROM identified)                                                        AS identified_accounts,
  (SELECT count(*) FROM identified WHERE malformed)                                        AS accounts_with_malformed_receipts,
  (SELECT count(*) FROM identified i LEFT JOIN latest l USING ("userId")
     WHERE l.decision IS DISTINCT FROM 'RELEASE_TO_FLOOR')                                  AS accounts_on_hold,
  (SELECT count(*) FROM "Withdrawal" w JOIN identified i USING ("userId")
     WHERE w.status IN ('PENDING','APPROVED'))                                             AS open_withdrawals_on_identified,
  (SELECT count(*) FROM "Withdrawal" w JOIN identified i USING ("userId")
     WHERE w.status = 'SENT' AND w."createdAt" >= i.first_sale)                            AS sent_withdrawals_after_first_sale,
  (SELECT count(*) FROM "Trade" t JOIN identified i ON i."userId" IN (t."takerUserId", t."makerUserId")
     WHERE t."executedAt" >= i.first_sale AND t."takerUserId" NOT LIKE 'simulation:%' AND t."makerUserId" NOT LIKE 'simulation:%'
       AND t."takerUserId" <> t."makerUserId")                                              AS trades_with_other_accounts_after_first_sale,
  (SELECT count(*) FROM "Order" o JOIN identified i USING ("userId")
     WHERE o.status IN ('OPEN','PARTIALLY_FILLED','PENDING_TRIGGER'))                      AS open_orders_on_identified,
  (SELECT count(*) FROM "FuturesBalance" f JOIN identified i USING ("userId")
     WHERE f.available > 0 OR f.locked > 0)                                                AS nonzero_futures_balances_on_identified,
  -- Downstream (historical counterparty) exposure: aggregate counts only, never identifiers or amounts.
  (SELECT count(*) FROM contacts WHERE counterparty NOT IN (SELECT "userId" FROM identified)) AS counterparty_accounts_after_first_sale,
  (SELECT count(*) FROM contacts WHERE identified_paid_quote
     AND counterparty NOT IN (SELECT "userId" FROM identified))                            AS counterparties_paid_quote_by_identified,
  (SELECT count(DISTINCT c.counterparty) FROM contacts c JOIN "Withdrawal" w ON w."userId" = c.counterparty
     WHERE w."createdAt" >= c.first_contact AND w.status IN ('PENDING','APPROVED','SENT')
       AND c.counterparty NOT IN (SELECT "userId" FROM identified))                        AS counterparties_with_withdrawals_after_contact,
  (SELECT count(*) FROM "BankingReferralReward" r JOIN identified i ON i."userId" = r."referredUserId") AS banking_referral_rewards_from_identified,
  (SELECT count(*) FROM "AuditLog" a WHERE a.action = 'DEPOSIT_ATTRIBUTED'
     AND (a.metadata->>'fromUserId' IN (SELECT "userId" FROM identified)
       OR a.metadata->>'toUserId' IN (SELECT "userId" FROM identified)))                   AS deposit_reattributions_touching_identified;
