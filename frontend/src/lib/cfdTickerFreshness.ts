export interface CfdTickerFreshnessRow{price?:string|null;status?:string;stale?:boolean;asOf?:number|null;maxQuoteAgeMs?:number;}

/** Keep a page from showing an old quote as Live while the next HTTP refresh is pending. */
export function ageCfdTickerRows<T extends CfdTickerFreshnessRow>(rows:T[],now=Date.now()):T[]{
  let changed=false;
  const next=rows.map(row=>{
    if(row.status!=='live'||row.price==null)return row;
    const asOf=row.asOf,maxAge=Math.max(30_000,Math.min(180_000,row.maxQuoteAgeMs??120_000));
    const expired=typeof asOf!=='number'||!Number.isFinite(asOf)||asOf<=0||asOf>now+1000||now-asOf>maxAge;
    if(!expired)return row;
    changed=true;return{...row,status:'stale',stale:true} as T;
  });
  return changed?next:rows;
}
