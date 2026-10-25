/** Local-only DEX embeds. Addresses issuer-verified and Raydium pool-owner/mint/swap checked 25 Oct 2026. */
export type OnchainEmbedMarket = { ticker: string; name: string; mint: string; pool: string };
export const ONCHAIN_EMBED_MARKETS: readonly OnchainEmbedMarket[] = Object.freeze([
  {ticker:'AAPLx', name:'Apple xStock', mint:'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', pool:'ApniVWuZbZoruTAJdyJcLBA4AVw4DKGdV5fHxo6qrAZT'},
  {ticker:'TSLAx', name:'Tesla xStock', mint:'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', pool:'8aDaBQkTrS6HVMjyc6EZebgdiaXhLYGriDWKWWp1NpFF'},
  {ticker:'NVDAx', name:'NVIDIA xStock', mint:'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', pool:'49iMatQtoyabsYAQc8GafVq6aeBFVDxSRH44oiatyyw6'},
  {ticker:'SPYx', name:'S&P 500 xStock ETF', mint:'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', pool:'4pCZCVEiYyT4efNdXUdL2tJF8VGMgiMXrZWq6FiNXhRw'},
  {ticker:'GOOGLx', name:'Alphabet xStock', mint:'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', pool:'B8YAwjGYk6qidWzGBXMAxP7nYfG8g74EZ3Y4gFSsobRw'},
  {ticker:'MSTRx', name:'Strategy xStock', mint:'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', pool:'RyhF4cksVZY7vcqJpoytHcxcGNKRp27PEGhSnEPpbGv'},
  {ticker:'QQQx', name:'Nasdaq-100 xStock ETF', mint:'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', pool:'GMjGLWzvK75LPetrgAmdeXnvxc4fUuQPwJxeQqTDU1aG'}
]);

export function mayMountOnchainEmbedPreview(hostname: string | undefined, devBuild: boolean, flag: string | undefined): boolean {
  return hostname === '127.0.0.1' && devBuild === true && flag === '1';
}

function ensureMarket(market: OnchainEmbedMarket): void {
  if (!ONCHAIN_EMBED_MARKETS.some(x => x.ticker === market.ticker && x.pool === market.pool && x.mint === market.mint)) throw Error('UNKNOWN_MARKET');
}
export function onchainPoolUrl(market: OnchainEmbedMarket): string {
  ensureMarket(market);
  return 'https://www.geckoterminal.com/solana/pools/' + market.pool;
}
export function onchainEmbedUrl(market: OnchainEmbedMarket): string {
  const url = new URL(onchainPoolUrl(market));
  for (const [k,v] of Object.entries({embed:'1',info:'0',swaps:'0',light_chart:'0',chart_type:'price',resolution:'1h',bg_color:'101318'})) url.searchParams.set(k,v);
  return url.href;
}
