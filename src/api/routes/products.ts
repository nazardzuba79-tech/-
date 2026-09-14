import { Router } from 'express';
import { z } from 'zod';
import BigNumber from 'bignumber.js';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { requireAdmin } from '../middleware/admin';
import { PurchaseService, PurchaseError } from '../../services/PurchaseService';
import { bankingRouter } from './banking';

const createProductSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().min(1).max(2000),
  priceAmount: z.string().refine((v) => new BigNumber(v).isGreaterThan(0), 'price must be > 0'),
  priceAsset: z.string().min(1).max(10),
});

const updateProductSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().min(1).max(2000).optional(),
  priceAmount: z
    .string()
    .refine((v) => new BigNumber(v).isGreaterThan(0), 'price must be > 0')
    .optional(),
  priceAsset: z.string().min(1).max(10).optional(),
  active: z.boolean().optional(),
});

export function productsRouter(prisma: PrismaClient): Router {
  const router = Router();
  const purchaseService = new PurchaseService(prisma);

  // Banking & Earn is mounted here because this router is already attached
  // at /api/v1. Banking keeps its own routes/service/ledger and does not use
  // the product-purchase balance path below.
  router.use(bankingRouter(prisma));

  // Public catalog — anyone can browse without logging in.
  router.get('/products', async (_req, res) => {
    const products = await prisma.product.findMany({ where: { active: true }, orderBy: { createdAt: 'desc' } });
    res.json(
      products.map(
        (p: { id: string; name: string; description: string; priceAmount: { toString(): string }; priceAsset: string }) => ({
          id: p.id,
          name: p.name,
          description: p.description,
          priceAmount: p.priceAmount.toString(),
          priceAsset: p.priceAsset,
        })
      )
    );
  });

  router.post('/products', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = createProductSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const product = await prisma.product.create({ data: parsed.data });
    res.status(201).json({ ...product, priceAmount: product.priceAmount.toString() });
  });

  router.get('/admin/products', requireAuth(prisma), requireAdmin(prisma), async (_req, res) => {
    const products = await prisma.product.findMany({ orderBy: { createdAt: 'desc' } });
    res.json(products.map((p) => ({ ...p, priceAmount: p.priceAmount.toString() })));
  });

  router.patch('/products/:id', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    const parsed = updateProductSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    if (Object.keys(parsed.data).length === 0) return res.status(400).json({ error: 'No fields to update' });
    try {
      const product = await prisma.product.update({ where: { id: req.params.id }, data: parsed.data });
      res.json({ ...product, priceAmount: product.priceAmount.toString() });
    } catch {
      res.status(404).json({ error: 'Product not found' });
    }
  });

  router.delete('/products/:id', requireAuth(prisma), requireAdmin(prisma), async (req, res) => {
    await prisma.product.update({ where: { id: req.params.id }, data: { active: false } });
    res.status(204).send();
  });

  router.post('/purchases', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const schema = z.object({ productId: z.string().min(1) });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    try {
      const purchase = await purchaseService.purchaseProduct(req.userId!, parsed.data.productId);
      res.status(201).json({ ...purchase, amount: purchase.amount.toString() });
    } catch (err) {
      if (err instanceof PurchaseError) return res.status(400).json({ error: err.message });
      console.error(err);
      res.status(500).json({ error: 'Purchase failed' });
    }
  });

  router.get('/purchases/me', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const purchases = await prisma.purchase.findMany({
      where: { userId: req.userId },
      include: { product: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      purchases.map(
        (p: {
          id: string;
          product: { name: string };
          amount: { toString(): string };
          asset: string;
          status: string;
          createdAt: Date;
        }) => ({
          id: p.id,
          productName: p.product.name,
          amount: p.amount.toString(),
          asset: p.asset,
          status: p.status,
          createdAt: p.createdAt,
        })
      )
    );
  });

  return router;
}
