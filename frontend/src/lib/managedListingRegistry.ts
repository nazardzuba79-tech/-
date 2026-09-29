// Public immutable identities only. Never stores drafts, secrets or allocation.
const directory = new Map<string, {logo:string;name:string}>();
export const isManagedPair = (pair: string) => directory.has(pair.toUpperCase());
export const managedLogo = (symbol: string) => directory.get(`${symbol.toUpperCase()}/USDT`)?.logo;
export const managedName = (pair: string) => directory.get(pair.toUpperCase())?.name;
export function rememberManaged(pair:string,logo:string,name:string) { directory.set(pair,{logo,name}); }
