import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { BankingError, BankingService } from '../../banking/service';

const decimalString = z.string().min(1).max(80).refine(value => {
  const number = new BigNumber(value);
  return number.isFinite() && number.isGreaterThan(0);
}, 'amount must be a positive decimal');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const calculationSchema = z.object({
  programId: z.enum(['MONTHLY_17_24M','COMPOUND_21_12M']),
  asset: z.enum(['USDT','USDC','BTC','ETH','SOL']),
  amount: decimalString,
  startDate: isoDate,
  periodMonths: z.number().int().min(1).max(24).optional(),
  endDate: isoDate.optional(),
}).refine(value => Boolean(value.periodMonths) !== Boolean(value.endDate), { message:'provide exactly one period selector' });

const placementSchema = z.object({
  programId: z.enum(['MONTHLY_17_24M','COMPOUND_21_12M']),
  asset: z.enum(['USDT','USDC','BTC','ETH','SOL']),
  amount: decimalString,
  idempotencyKey: z.string().min(8).max(120),
});

export function bankingRouter(prisma: PrismaClient): Router {
  const router=Router(), service=new BankingService(prisma);
  const handle=(res:any,error:unknown)=>{
    if(error instanceof BankingError)return res.status(error.status).json({error:error.code});
    console.error('Banking request failed',error);return res.status(500).json({error:'banking_unavailable'});
  };
  router.get('/banking/config',requireAuth(prisma),async(_req,res)=>{try{res.json(await service.config());}catch(error){handle(res,error);}});
  router.get('/banking/state',requireAuth(prisma),async(req:AuthedRequest,res)=>{try{res.json(await service.state(req.userId!));}catch(error){handle(res,error);}});
  router.post('/banking/calculate',requireAuth(prisma),async(req,res)=>{
    const parsed=calculationSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_calculation_request',details:parsed.error.flatten()});
    try{res.json(await service.calculate(parsed.data));}catch(error){handle(res,error);}
  });
  router.post('/banking/placements',requireAuth(prisma),async(req:AuthedRequest,res)=>{
    const parsed=placementSchema.safeParse(req.body);if(!parsed.success)return res.status(400).json({error:'invalid_placement_request',details:parsed.error.flatten()});
    try{res.status(201).json(await service.createPlacement(req.userId!,parsed.data));}catch(error){handle(res,error);}
  });
  return router;
}
