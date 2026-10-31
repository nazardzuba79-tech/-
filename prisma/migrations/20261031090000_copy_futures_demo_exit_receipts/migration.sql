-- TEST-ONLY copy metadata. A source position closed by take-profit, stop-loss or liquidation is
-- recorded (observer) and refused on the record (executor, SOURCE_EXIT_NOT_MIRRORED) instead of
-- being skipped silently. Only the two copy tables' kind checks widen; no financial table, no row.
ALTER TABLE "CopyFuturesDemoEvent" DROP CONSTRAINT "CopyFuturesDemoEvent_kind_check";
ALTER TABLE "CopyFuturesDemoEvent" ADD CONSTRAINT "CopyFuturesDemoEvent_kind_check"
  CHECK ("kind" IN ('OPEN', 'CLOSE', 'TAKE_PROFIT', 'STOP_LOSS', 'LIQUIDATION'));
ALTER TABLE "CopyFuturesDemoMirror" DROP CONSTRAINT "CopyFuturesDemoMirror_kind_check";
ALTER TABLE "CopyFuturesDemoMirror" ADD CONSTRAINT "CopyFuturesDemoMirror_kind_check"
  CHECK ("kind" IN ('OPEN', 'CLOSE', 'TAKE_PROFIT', 'STOP_LOSS', 'LIQUIDATION'));
