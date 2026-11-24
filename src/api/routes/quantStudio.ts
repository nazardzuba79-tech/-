import sharp from "sharp";
import { Router } from "express";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@prisma/client";
import { asyncRoute } from "../asyncRoute";
import { requireAuth, type AuthedRequest } from "../middleware/auth";

type Reader = Pick<Prisma.TransactionClient, "copyStrategyOwner">;
function premiumAuthor(db: Reader, userId: string) {
  return db.copyStrategyOwner.findFirst({
    where: {
      premium: true,
      OR: [
        { ownerUserId: userId },
        { ownerUserId: null, studioAuthorUserId: userId },
      ],
    },
    select: { traderId: true },
  });
}
const fields = {
  settings: true,
  revision: true,
  id: true,
  name: true,
  pair: true,
  description: true,
  publishedAt: true,
} as const;
const settings = z
  .object({
    category: z.enum([
      "Quantitative Intelligence",
      "Grid",
      "DCA",
      "Momentum",
      "Market Neutral",
      "Rebalance",
      "Breakout",
    ]),
    risk: z.enum(["Низкий", "Умеренный", "Повышенный"]),
    minInvestmentUsdt: z.number().finite().min(0).max(1e9),
    maxDrawdownStop: z.number().finite().min(0).max(100),
    lookbackWindow: z.number().int().min(1).max(3650),
    rebalanceInterval: z.enum(["1 час", "4 часа", "12 часов", "24 часа"]),
    presetLogoId: z.enum([
      "thomas-quant-ai",
      "atlas-grid",
      "ether-dca",
      "sol-momentum",
      "delta-balance",
      "smart-rebalance",
      "breakout-pro",
    ]),
    customLogoUrl: z.string().max(82000).nullable(),
  })
  .strict();

// Decode and re-encode raster bytes; never store submitted containers or metadata.
async function logo(input: string) {
  const match =
    /^data:image\/(png|webp|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(input);
  if (!match) throw Error("Invalid logo");
  const bytes = Buffer.from(match[2], "base64");
  if (bytes.length > 60 * 1024 || bytes.toString("base64") !== match[2])
    throw Error("Invalid logo");
  const reader = sharp(bytes, {
    limitInputPixels: 1024 * 1024,
    failOn: "warning",
  });
  const meta = await reader.metadata();
  if (
    meta.format !== match[1] ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) !== 1
  )
    throw Error("Invalid logo");
  const result = await reader
    .resize(192, 192, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  return "data:image/webp;base64," + result.toString("base64");
}

const draft = z
  .object({
    settings: settings.optional(),
    name: z.string().trim().min(3).max(60),
    pair: z.enum(["BTC/USDT", "ETH/USDT", "SOL/USDT", "XRP/USDT", "BNB/USDT"]),
    description: z.string().trim().min(16).max(320),
  })
  .strict();

export function quantStudioRouter(prisma: PrismaClient, thomasId: string) {
  const router = Router();
  router.use("/trading-bots/studio", requireAuth(prisma), (_req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    next();
  });
  router.get(
    "/trading-bots/studio",
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const [grants, published] = await Promise.all([
        prisma.copyStrategyOwner.findMany({
          where: {
            premium: true,
            OR: [
              { ownerUserId: { in: [ownerUserId, thomasId] } },
              {
                ownerUserId: null,
                studioAuthorUserId: { in: [ownerUserId, thomasId] },
              },
            ],
          },
          select: { ownerUserId: true, studioAuthorUserId: true },
          distinct: ["ownerUserId", "studioAuthorUserId"],
        }),
        prisma.quantStrategyDraft.findMany({
          where: { publishedAt: { not: null } },
          orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
          take: 24,
          select: { ...fields, owner: { select: { displayName: true } } },
        }),
      ]);
      const eligible = new Set(
        grants.map((grant) => grant.ownerUserId ?? grant.studioAuthorUserId),
      );
      const viewer = eligible.has(ownerUserId),
        thomas = eligible.has(thomasId);
      const drafts = viewer
        ? await prisma.quantStrategyDraft.findMany({
            where: { ownerUserId },
            orderBy: { createdAt: "desc" },
            select: fields,
          })
        : [];
      res.json({ canCreate: !!viewer, thomasVip: !!thomas, published, drafts });
    }),
  );
  router.post(
    "/trading-bots/studio/drafts",
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const result = await prisma.$transaction(
        async (tx) => {
          if (!(await premiumAuthor(tx, ownerUserId))) return { status: 403 };
          const parsed = draft.safeParse(req.body);
          if (!parsed.success) return { status: 400 };
          if (parsed.data.settings?.customLogoUrl) {
            try {
              parsed.data.settings.customLogoUrl = await logo(
                parsed.data.settings.customLogoUrl,
              );
            } catch {
              return { status: 400 };
            }
          }
          return {
            status: 201,
            data: await tx.quantStrategyDraft.create({
              data: { ...parsed.data, ownerUserId },
              select: fields,
            }),
          };
        },
        { isolationLevel: "Serializable" },
      );
      res
        .status(result.status)
        .json(result.data ?? { error: "Draft unavailable" });
    }),
  );
  router.post(
    "/trading-bots/studio/drafts/:id/publish",
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const status = await prisma.$transaction(
        async (tx) => {
          if (!(await premiumAuthor(tx, ownerUserId))) return 403;
          const updated = await tx.quantStrategyDraft.updateMany({
            where: { id: req.params.id, ownerUserId, publishedAt: null },
            data: { publishedAt: new Date(), revision: { increment: 1 } },
          });
          return updated.count === 1 ? 200 : 404;
        },
        { isolationLevel: "Serializable" },
      );
      res.status(status).json({ published: status === 200 });
    }),
  );
  router.patch(
    "/trading-bots/studio/drafts/:id",
    asyncRoute(async (req: AuthedRequest, res) => {
      const ownerUserId = req.userId!;
      const result = await prisma.$transaction(
        async (tx) => {
          if (!(await premiumAuthor(tx, ownerUserId))) return { status: 403 };
          const parsed = draft
            .extend({
              revision: z.number().int().positive(),
              published: z.boolean(),
            })
            .safeParse(req.body);
          if (!parsed.success) return { status: 400 };
          const { revision, published, ...data } = parsed.data;
          if (data.settings?.customLogoUrl) {
            try {
              data.settings.customLogoUrl = await logo(
                data.settings.customLogoUrl,
              );
            } catch {
              return { status: 400 };
            }
          }
          const current = await tx.quantStrategyDraft.findFirst({
            where: { id: req.params.id, ownerUserId },
            select: { publishedAt: true },
          });
          if (!current) return { status: 404 };
          const updated = await tx.quantStrategyDraft.updateMany({
            where: { id: req.params.id, ownerUserId, revision },
            data: {
              ...data,
              revision: { increment: 1 },
              publishedAt: published
                ? (current.publishedAt ?? new Date())
                : null,
            },
          });
          if (updated.count !== 1) return { status: 409 };
          return {
            status: 200,
            data: await tx.quantStrategyDraft.findUniqueOrThrow({
              where: { id: req.params.id },
              select: fields,
            }),
          };
        },
        { isolationLevel: "Serializable" },
      );
      res
        .status(result.status)
        .json(result.data ?? { error: "Strategy unavailable" });
    }),
  );
  return router;
}
