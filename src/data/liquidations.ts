export const liquidationFilters = {
  assets: ['BTC', 'ETH', 'SOL', 'XRP'],
  ranges: ['±2%', '±4%', '±6%', 'GLOBAL'],
  windows: ['4Ч', '12Ч', '24Ч', '3Д'],
  exchanges: ['Все биржи', 'Binance', 'Bybit', 'OKX', 'Deribit', 'Bitget']
};

export const liquidationStats = [
{ label: 'Ликвидации 12ч', value: '$428.6M' },
{ label: 'Ближайшая стена выше', value: '$69,332 · +1.3%' },
{ label: 'Ближайшая стена ниже', value: '$67,008 · -2.1%' },
{ label: 'Видимый диапазон', value: '±4%' }];

export type LiquidationBin = { price:number; label?:string; binance:number; bybit:number; okx:number; deribit:number; bitget:number; cumLong:number; cumShort:number; zone?:'gap'|'wall'|'short'|'long'|'critical'; zoneLabel?:string; };
export const currentPrice = 68420;
export const liquidationBins: LiquidationBin[] = [
{ price:65683,binance:42,bybit:26,okx:18,deribit:9,bitget:7,cumLong:100,cumShort:4 },
{ price:65808,binance:12,bybit:8,okx:6,deribit:3,bitget:2,cumLong:96,cumShort:5,zone:'gap',zoneLabel:'Зона низкой ликвидности' },
{ price:66208,binance:58,bybit:38,okx:26,deribit:12,bitget:10,cumLong:93,cumShort:7 },
{ price:66608,binance:74,bybit:46,okx:30,deribit:14,bitget:11,cumLong:84,cumShort:9,zone:'long',zoneLabel:'Концентрация Long' },
{ price:67008,binance:128,bybit:86,okx:54,deribit:22,bitget:18,cumLong:72,cumShort:12,zone:'critical',zoneLabel:'Критическая зона' },
{ price:67308,binance:46,bybit:30,okx:20,deribit:10,bitget:8,cumLong:58,cumShort:16 },
{ price:67508,binance:62,bybit:40,okx:26,deribit:12,bitget:9,cumLong:51,cumShort:20 },
{ price:67833,binance:152,bybit:98,okx:62,deribit:26,bitget:21,cumLong:44,cumShort:26,zone:'wall',zoneLabel:'Локальная стена ликвидности' },
{ price:68308,binance:14,bybit:9,okx:6,deribit:3,bitget:2,cumLong:28,cumShort:34,zone:'gap',zoneLabel:'Зона низкой ликвидности' },
{ price:68432,binance:38,bybit:24,okx:16,deribit:8,bitget:6,cumLong:22,cumShort:42 },
{ price:68932,binance:66,bybit:42,okx:28,deribit:13,bitget:10,cumLong:16,cumShort:54 },
{ price:69332,binance:138,bybit:92,okx:58,deribit:24,bitget:19,cumLong:11,cumShort:68,zone:'short',zoneLabel:'Концентрация Short' },
{ price:69632,binance:13,bybit:8,okx:5,deribit:3,bitget:2,cumLong:8,cumShort:76,zone:'gap',zoneLabel:'Зона низкой ликвидности' },
{ price:70257,binance:72,bybit:48,okx:30,deribit:14,bitget:11,cumLong:6,cumShort:84 },
{ price:70757,binance:54,bybit:34,okx:22,deribit:11,bitget:8,cumLong:4,cumShort:91 },
{ price:71157,binance:118,bybit:78,okx:50,deribit:21,bitget:16,cumLong:2,cumShort:100,zone:'short',zoneLabel:'Концентрация Short' }];
export const exchangeLegend = [
{key:'binance',label:'Binance',color:'#C08A18'},{key:'bybit',label:'Bybit',color:'#D9A43B'},{key:'okx',label:'OKX',color:'#8A9099'},{key:'deribit',label:'Deribit',color:'#5C6169'},{key:'bitget',label:'Bitget',color:'#31353B'}] as const;
export const nearestStructure = [
{label:'Выше цены',price:'$69,332',distance:'+1.3%',density:'Критическая плотность · $682.6M',side:'short' as const},
{label:'Ниже цены',price:'$67,833',distance:'-0.9%',density:'Высокая плотность · $843.2M',side:'long' as const},
{label:'Ближайшая зона низкой ликвидности',price:'У цены',distance:'-0.2%',density:'Разрыв ликвидности',side:'gap' as const}];
export type Cluster={price:string;side:'Long'|'Short'|'—';density:'Критическая плотность'|'Высокая плотность'|'Низкая плотность';volume:string;distance:string;zone:string};
export const clusters:Cluster[]=[
{price:'$69,332',side:'Short',density:'Критическая плотность',volume:'$682.6M',distance:'+1.3%',zone:'Стена ликвидности'},
{price:'$67,008',side:'Long',density:'Критическая плотность',volume:'$513.4M',distance:'-2.1%',zone:'Стена ликвидности'},
{price:'$67,833',side:'Long',density:'Высокая плотность',volume:'$843.2M',distance:'-0.9%',zone:'Локальный кластер'},
{price:'$67,308',side:'Short',density:'Высокая плотность',volume:'$121.3M',distance:'-1.6%',zone:'Локальный кластер'},
{price:'$71,157',side:'Short',density:'Высокая плотность',volume:'$1.13B',distance:'+4.0%',zone:'Локальный кластер'},
{price:'$69,632',side:'—',density:'Низкая плотность',volume:'$42.9M',distance:'+1.8%',zone:'Зона низкой ликвидности'},
{price:'$65,808',side:'—',density:'Низкая плотность',volume:'$41.6M',distance:'-3.8%',zone:'Зона низкой ликвидности'},
{price:'$68,308',side:'—',density:'Низкая плотность',volume:'$48.2M',distance:'-0.2%',zone:'Зона низкой ликвидности'}];
export const clusterFooter=[{label:'Long-ликвидность',value:'46%'},{label:'Short-ликвидность',value:'54%'},{label:'Крупнейший кластер',value:'$69,332'},{label:'Баланс вокруг цены (±2%)',value:'Выше 39% / Ниже 61%'}];
export const largeLiquidations=[
{time:'08:41',asset:'BTC',side:'Long' as const,price:'$68,180',volume:'$4.2M',exchange:'Binance'},
{time:'08:22',asset:'BTC',side:'Short' as const,price:'$69,050',volume:'$2.8M',exchange:'OKX'},
{time:'07:58',asset:'BTC',side:'Long' as const,price:'$67,940',volume:'$6.1M',exchange:'Bybit'},
{time:'07:31',asset:'BTC',side:'Short' as const,price:'$68,910',volume:'$1.9M',exchange:'Deribit'},
{time:'06:47',asset:'BTC',side:'Long' as const,price:'$67,510',volume:'$9.4M',exchange:'Binance'}];
