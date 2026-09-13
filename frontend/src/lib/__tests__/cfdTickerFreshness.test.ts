import { ageCfdTickerRows } from '../useCfdTickers';
import type { CfdTickerRow } from '../../components/CfdInstrumentList';

const NOW = Date.UTC(2026,8,14,12,0,0);
const live = (over: Partial<CfdTickerRow> = {}): CfdTickerRow => ({
  symbol:'EURUSD', name:'EUR/USD', price:'1.10', status:'live', stale:false, executionAllowed:true,
  providerTimestamp:NOW, fetchedAt:NOW, maxQuoteAgeMs:5000, ...over,
});

describe('CFD browser freshness aging',()=>{
  test('fresh executable quote stays executable without cloning state',()=>{
    const rows=[live()];expect(ageCfdTickerRows(rows,NOW+1000)).toBe(rows);expect(rows[0].executionAllowed).toBe(true);
  });
  test('expired live quote keeps last display price but blocks execution immediately',()=>{
    const aged=ageCfdTickerRows([live()],NOW+5001)[0];
    expect(aged).toMatchObject({price:'1.10',status:'stale',stale:true,executionAllowed:false});
  });
  test('future/missing live timestamps fail closed in the browser',()=>{
    expect(ageCfdTickerRows([live({providerTimestamp:NOW+5000})],NOW)[0].executionAllowed).toBe(false);
    expect(ageCfdTickerRows([live({fetchedAt:null})],NOW)[0].executionAllowed).toBe(false);
  });
  test('expired display reference becomes visibly last-known and can never execute',()=>{
    const row=live({displayOnly:true,status:'reference_only',executionAllowed:false,referenceValidUntil:NOW+1000,
      referenceLabel:'Daily reference · U.S. EIA · 2026-09-11 · WTI Cushing · USD/barrel'});
    const aged=ageCfdTickerRows([row],NOW+1001)[0];
    expect(aged).toMatchObject({price:'1.10',displayOnly:true,status:'stale',stale:true,executionAllowed:false});
    expect(aged.referenceLabel).toMatch(/^Last known · Daily reference/);
  });
  test('display-only zero is still data when its reference expires',()=>{
    const aged=ageCfdTickerRows([live({price:'0',displayOnly:true,status:'reference_only',executionAllowed:false,referenceValidUntil:NOW-1})],NOW)[0];
    expect(aged.price).toBe('0');expect(aged.stale).toBe(true);
  });
});
