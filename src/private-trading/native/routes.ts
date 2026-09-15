import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { NativeCommand, NativeDemoService } from './service';
import { OwnerSession } from '../serviceTypes';
import { DemoEngineError, NATIVE_DEMO_MODEL } from './engine';
import BigNumber from 'bignumber.js';
const key=z.string().min(8).max(100).regex(/^[a-zA-Z0-9:_-]+$/);
const positive=z.string().max(60).regex(/^\d{1,18}(?:\.\d{1,18})?$/).refine(x=>new BigNumber(x).gt(0));
const candle=z.object({source:z.literal('BYBIT_LINEAR'),interval:z.enum(['1m','5m','15m','1h','4h','1d','1w']),openTime:z.number().int().positive(),pricePoint:z.enum(['OPEN','CLOSE'])}).strict();
const protection=z.object({takeProfit:positive.nullable().optional(),stopLoss:positive.nullable().optional(),triggerBy:z.enum(['MARK','LAST']).optional(),quantity:positive.nullable().optional()}).strict();
export const nativeCommandSchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('OPEN'),idempotencyKey:key,symbol:z.string().regex(/^[A-Z0-9]{1,32}(?:\/)?USDT$/),side:z.enum(['LONG','SHORT']),type:z.enum(['MARKET','LIMIT']),margin:positive.optional(),quantity:positive.optional(),leverage:positive,price:positive.optional(),candle:candle.optional(),protection:protection.optional()}).strict(),
  z.object({kind:z.literal('CLOSE'),idempotencyKey:key,positionId:key,quantity:positive.optional(),candle:candle.optional()}).strict(),
  z.object({kind:z.literal('CANCEL'),idempotencyKey:key,orderId:key}).strict(),
  z.object({kind:z.literal('PROTECTION'),idempotencyKey:key,positionId:key,protection}).strict(),
  z.object({kind:z.literal('LEVERAGE'),idempotencyKey:key,positionId:key,leverage:positive}).strict(),
  z.object({kind:z.literal('REFRESH'),idempotencyKey:key}).strict(),
]).superRefine((x,c)=>{if(x.kind==='OPEN'&&(Boolean(x.margin)===Boolean(x.quantity)||x.type==='LIMIT'&&!x.price))c.addIssue({code:'custom',message:'Укажите маржу или количество; для лимитного ордера нужна цена'});});
export const NATIVE_ERROR_TEXT:Record<string,string>={
  HISTORY_GAP:'История содержит пропуски. Сделка не записана.',HISTORY_LIMIT:'Слишком длинный участок истории для одного расчёта.',MARK_HISTORY_GAP:'Нет Mark Price истории для этого участка.',
  INSUFFICIENT_DEMO_MARGIN:'Недостаточно общей демо-маржи.',INSUFFICIENT_FILL_MARGIN:'Недостаточно общей демо-маржи для исполнения.',
  ENTRY_MARK_UNAVAILABLE:'Недостаточно Mark Price истории для выбранной свечи.',POSITION_NOT_OPEN:'Позиция уже закрыта или не найдена.',
  INVALID_TRIGGER_PRICE:'Проверьте цену TP/SL относительно текущей цены.',INVALID_TRIGGER_STEP:'Цена TP/SL не кратна шагу цены.',INVALID_PROTECTION_QUANTITY:'Количество TP/SL больше позиции или не кратно шагу.',
  SET_EXISTING_POSITION_LEVERAGE_FIRST:'Сначала измените плечо уже открытой позиции.',CANCEL_ORDERS_BEFORE_LEVERAGE:'Сначала отмените активные ордера этой позиции.',
  EXIT_BEFORE_ENTRY:'Свеча выхода должна быть позже входа.',CONTRACT_LIMIT:'Одновременно можно держать не более 6 разных контрактов.',
  CLOSE_EXCEEDS_POSITION:'Количество больше открытой позиции.',LIMIT_PRICE_REQUIRED:'Укажите лимитную цену.',ORDER_NOT_OPEN:'Ордер уже исполнен или отменён.',ORDER_NOT_FOUND:'Ордер не найден.',
  LATEST_MARK_STALE:'Котировка устарела. Повторите.',STALE_BOOK:'Стакан устарел. Повторите.',COMMAND_LIMIT:'Достигнут лимит операций демо-счёта.',ACCOUNT_MISSING:'Демо-счёт не подключён.',POSITION_MISSING:'Позиция не найдена.',
};
const NATIVE_INPUT_ERROR_TEXT:Record<string,string>={
  INVALID_ORDER_SIZE:'Размер ордера вне лимитов контракта (мин./макс. количество или минимальная стоимость).',INVALID_QUANTITY_STEP:'Количество не кратно шагу контракта.',
  INVALID_PRICE_STEP:'Цена не кратна шагу цены контракта.',INVALID_LEVERAGE:'Недопустимое плечо для контракта.',TIER_LEVERAGE_EXCEEDED:'Плечо выше допустимого для такого размера позиции.',
  RISK_LIMIT_EXCEEDED:'Позиция превышает лимит риска контракта.',INVALID_QUANTITY:'Маржа слишком мала для минимального количества.',INVALID_AMOUNT:'Проверьте числовые значения.',INVALID_PRICE:'Проверьте цену.',
};
/** Mount ONLY below the existing authenticated owner+ADMIN+session middleware. */
export function nativeDemoRoutes(service:NativeDemoService,actor:(res:Response)=>OwnerSession){
  const r=Router();const handle=(run:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>void run(req,res).then(result=>res.json(result)).catch(next);
  r.get('/state',handle((_req,res)=>service.state(actor(res))));
  r.post('/initialize',handle((req,res)=>{const input=z.object({idempotencyKey:key,acceptedModel:z.literal(NATIVE_DEMO_MODEL.version)}).strict().parse(req.body);return service.initialize(actor(res),input.idempotencyKey);}));
  r.post('/commands',handle((req,res)=>service.command(actor(res),nativeCommandSchema.parse(req.body) as NativeCommand)));
  r.post('/cards',handle((req,res)=>service.card(actor(res),z.object({positionId:key}).strict().parse(req.body).positionId)));
  r.get('/cards/:revision/:positionId',handle((req,res)=>service.card(actor(res),key.parse(req.params.positionId),z.coerce.number().int().positive().parse(req.params.revision))));
  r.use((e:unknown,_req:Request,res:Response,next:NextFunction)=>{
    if(e instanceof DemoEngineError)return res.status(409).json({code:e.code,error:NATIVE_ERROR_TEXT[e.code]??`Расчёт остановлен: ${e.code}`});
    // Contract-rule violations from the shared decimal validators are the owner's input, not a server fault.
    if(e instanceof Error&&Object.prototype.hasOwnProperty.call(NATIVE_INPUT_ERROR_TEXT,e.message))return res.status(400).json({code:e.message,error:NATIVE_INPUT_ERROR_TEXT[e.message]});
    next(e);
  });return r;
}
