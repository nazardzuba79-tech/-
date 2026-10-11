// Isolated benchmark protocol fixture. Never imported by the application.
// Both comparison images use this identical native pagination contract.
const periods={'1':60000,'5':300000,'15':900000,'30':1800000,'60':3600000,'240':14400000,'D':86400000,'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000};
export function nativeHistoryFixture(url,now=Date.now()){
  const u=new URL(url),bybit=u.hostname==='api.bybit.com';
  if(!(bybit&&u.pathname==='/v5/market/kline')&&!(u.hostname==='api.binance.com'&&u.pathname==='/api/v3/klines'))throw Error('FIXTURE_TRANSPORT_DENIED');
  const step=periods[u.searchParams.get('interval')],limit=Number(u.searchParams.get('limit')??300);
  if(!step||!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid fixture pagination');
  const before=Number(u.searchParams.get(bybit?'end':'endTime')??now);
  if(!Number.isSafeInteger(before)||before<0)throw Error('Invalid fixture end');
  // Provider end is inclusive. The public adapter applies its own strict-end
  // filter AFTER selecting the native limit; an aligned end can yield299 rows.
  const end=Math.floor(before/step)*step;
  const rows=Array.from({length:limit},(_,n)=>[String(end-(limit-1-n)*step),'100.12345678','102.87654321','99.01234567','101.56781234','25']);
  return bybit?{retCode:0,result:{symbol:u.searchParams.get('symbol'),list:rows.reverse()}}:rows;
}
