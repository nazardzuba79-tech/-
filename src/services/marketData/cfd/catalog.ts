/** Verified 2026-09-12 against official public /commodities and /forex_pairs.
 * This is provider support, NOT an account entitlement or execution whitelist.
 * Exact upstream rows and URLs are recorded in docs/qa/inverse-options-cfd/.
 * Natural Gas was not in that verified set and is deliberately not invented. */
export const CFD_REFERENCE_CATALOG = [
  { providerSymbol:'XAU/USD', name:'Gold Spot', assetClass:'metals' },
  { providerSymbol:'XAG/USD', name:'Silver Spot', assetClass:'metals' },
  { providerSymbol:'XPT/USD', name:'Platinum Spot', assetClass:'metals' },
  { providerSymbol:'XPD/USD', name:'Palladium Spot', assetClass:'metals' },
  { providerSymbol:'WTI/USD', name:'Crude Oil WTI Spot', assetClass:'energy' },
  { providerSymbol:'XBR/USD', name:'Brent Spot', assetClass:'energy' },
  { providerSymbol:'EUR/USD', name:'Euro vs US Dollar', assetClass:'forex' },
  { providerSymbol:'GBP/USD', name:'British Pound vs US Dollar', assetClass:'forex' },
  { providerSymbol:'USD/JPY', name:'US Dollar vs Japanese Yen', assetClass:'forex' },
  { providerSymbol:'AUD/USD', name:'Australian Dollar vs US Dollar', assetClass:'forex' },
  { providerSymbol:'USD/CAD', name:'US Dollar vs Canadian Dollar', assetClass:'forex' },
  { providerSymbol:'USD/CHF', name:'US Dollar vs Swiss Franc', assetClass:'forex' },
  { providerSymbol:'NZD/USD', name:'New Zealand Dollar vs US Dollar', assetClass:'forex' },
].map(row => ({ ...row, symbol:row.providerSymbol.replace('/',''), provider:'twelvedata', supportVerifiedAt:'2026-09-12', providerSupported:true }));

/** One quota owner per API key/process. Every attempt (including retry) spends
 * credits BEFORE HTTP. Conservative rolling windows avoid minute-edge bursts.
 * Multi-replica/shared-key production needs a shared persistent limiter. */
export class CfdCreditBudget {
  private spent: { at:number; cost:number }[] = [];
  constructor(readonly perMinute = 8, readonly perDay = 800, private now = Date.now) {
    if (![perMinute,perDay].every(n => Number.isSafeInteger(n) && n > 0)) throw new Error('Invalid CFD credit budget');
  }
  take(cost: number): void {
    const now = this.now(); this.spent = this.spent.filter(r => now-r.at < 86_400_000);
    const minute = this.spent.filter(r => now-r.at < 60_000).reduce((n,r) => n+r.cost,0);
    const day = this.spent.reduce((n,r) => n+r.cost,0);
    if (!Number.isSafeInteger(cost) || cost < 1 || minute+cost > this.perMinute || day+cost > this.perDay) throw new Error('CFD credit budget exhausted');
    // Coalesce attempts in the same second to bound memory by 86,400 entries.
    const last = this.spent[this.spent.length-1];
    if (last && Math.floor(last.at/1000) === Math.floor(now/1000)) { last.cost += cost; last.at = now; }
    else this.spent.push({at:now,cost});
  }
  diagnostics() {
    const now = this.now();
    return { perMinute:this.perMinute, perDay:this.perDay, minuteUsed:this.spent.filter(r=>now-r.at<60_000).reduce((n,r)=>n+r.cost,0),
      dayUsed:this.spent.filter(r=>now-r.at<86_400_000).reduce((n,r)=>n+r.cost,0), scope:'process' };
  }
}
