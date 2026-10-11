// Pure reporting. Neither failed requests nor deadline samples are discarded.
export function combineMetrics(reader,server){
  if(!reader?.fixture||!server?.fixture)throw Error('Capacity reports require fixture provenance');
  const throttle=raw=>Object.fromEntries((raw??'').trim().split('\n').filter(Boolean).map(line=>{const[key,value]=line.split(/\s+/);return[key,Number(value)];}));
  const before=throttle(server.initial?.cpuStat),after=throttle(server.final?.cpuStat);
  const delta=key=>key in before&&key in after?after[key]-before[key]:null;
  const hubDelta=Object.fromEntries(Object.entries(server.hub??{}).filter(([,value])=>typeof value==='number').map(([key,value])=>[key,value-(server.hubInitial?.[key]??0)]));
  return {reader,server,hubDelta,acceptance:{deadlineMs:3000,errorsAllowed:0,pass:reader.errors===0&&reader.ok>0&&reader.latencyMs.max<=3000},perReader:{cpuVcpu:server.cpuVcpu/reader.users,cpuMs:server.cpuMs/reader.users,rssBytesAmortized:server.maxRssBytes/reader.users,sqlCalls:server.sqlCalls/reader.users,fixtureProviderHistoryCalls:server.fixtureProviderHistoryCalls/reader.users,fixtureQuoteCalls:server.fixtureQuoteCalls/reader.users,externalApiCalls:0,notes:'RSS divided by readers is shared-process amortization, not marginal per-user memory or an extrapolation.'},throttling:{periods:delta('nr_periods'),throttledPeriods:delta('nr_throttled'),throttledUs:delta('throttled_usec')},capacityScope:'Only this measured scenario and resource budget; synthetic transport does not certify provider latency/rate limits or real auth capacity.'};
}
