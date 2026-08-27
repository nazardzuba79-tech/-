import { Router } from 'express';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { ApiKeyService } from '../../services/ApiKeyService';

/**
 * Managing API keys (create/list/revoke) is JWT-only, deliberately NOT
 * reachable with another API key — a compromised bot key should never be
 * able to mint itself new keys or read the list of existing ones.
 */

const createSchema = z.object({
  label: z.string().min(1).max(100),
  canTrade: z.boolean().optional().default(false),
});

export function apiKeysRouter(prisma: PrismaClient): Router {
  const router = Router();
  const service = new ApiKeyService(prisma);

  router.get('/api-keys', requireAuth(prisma), async (req: AuthedRequest, res) => {
    res.json(await service.listKeys(req.userId!));
  });

  // The plaintext secret is returned ONLY in this response — it's never
  // retrievable again after this.
  router.post('/api-keys', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

    const key = await service.createKey(req.userId!, parsed.data.label, parsed.data.canTrade);
    res.status(201).json(key);
  });

  router.delete('/api-keys/:id', requireAuth(prisma), async (req: AuthedRequest, res) => {
    const revoked = await service.revokeKey(req.userId!, req.params.id);
    if (!revoked) return res.status(404).json({ error: 'API key not found' });
    res.status(204).send();
  });

  return router;
}
