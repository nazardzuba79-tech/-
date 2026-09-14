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
/** Mount ONLY below the existing authenticated owner+ADMIN+session middleware. */
export function nativeDemoRoutes(service:NativeDemoService,actor:(res:Response)=>OwnerSession){
  const r=Router();const handle=(run:(req:Request,res:Response)=>Promise<unknown>)=>(req:Request,res:Response,next:NextFunction)=>void run(req,res).then(result=>res.json(result)).catch(next);
  r.get('/state',handle((_req,res)=>service.state(actor(res))));
  r.post('/initialize',handle((req,res)=>{const input=z.object({idempotencyKey:key,acceptedModel:z.literal(NATIVE_DEMO_MODEL.version)}).strict().parse(req.body);return service.initialize(actor(res),input.idempotencyKey);}));
  r.post('/commands',handle((req,res)=>service.command(actor(res),nativeCommandSchema.parse(req.body) as NativeCommand)));
  r.post('/cards',handle((req,res)=>service.card(actor(res),z.object({positionId:key}).strict().parse(req.body).positionId)));
  r.get('/cards/:revision/:positionId',handle((req,res)=>service.card(actor(res),key.parse(req.params.positionId),z.coerce.number().int().positive().parse(req.params.revision))));
  r.use((e:unknown,_req:Request,res:Response,next:NextFunction)=>{
    if(e instanceof DemoEngineError){const messages:Record<string,string>={HISTORY_GAP:'История содержит пропуски. Сделка не записана.',INSUFFICIENT_DEMO_MARGIN:'Недостаточно общей демо-маржи.',NATIVE_BUSY:'Дождитесь расчёта.',ENTRY_MARK_UNAVAILABLE:'Недостаточно Mark Price истории для выбранной свечи.',POSITION_NOT_OPEN:'Позиция уже закрыта или не найдена.',INVALID_TRIGGER_PRICE:'Проверьте цену TP/SL относительно текущей цены.',SET_EXISTING_POSITION_LEVERAGE_FIRST:'Сначала измените плечо уже открытой позиции.',EXIT_BEFORE_ENTRY:'Свеча выхода должна быть позже входа.',FOUR_CONTRACT_LIMIT:'В этом preview доступны четыре разных контракта на один счёт.'};return res.status(409).json({code:e.code,error:messages[e.code]??`Расчёт остановлен: ${e.code}`});}
    next(e);
  });return r;
}
