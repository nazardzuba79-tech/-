import { Router } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { asyncRoute } from "../asyncRoute";
import { AuthedRequest, requireAuth } from "../middleware/auth";
import {
  authorUrl,
  SOCIAL_NAMES,
  type Network,
  type AuthorInfo,
} from "../../shared/thomasAuthor";
import type { LiveSource } from "../../services/marketData/live/contract";
import { thomasCoverage } from "../../services/thomasCoverage";

const editor = z
  .object({
    revision: z.number().int().min(0).max(2147483646),
    bio: z.string().trim().max(600),
    links: z.record(z.string().max(512)),
  })
  .strict();
type Stored = Pick<AuthorInfo, "bio" | "links" | "revision">;
export function thomasProfileRouter(
  db: PrismaClient,
  ownerId: string,
  feed: LiveSource | null,
) {
  const router = Router(),
    auth = requireAuth(db),
    coverage = thomasCoverage(feed);
  const base = "/trading-bots/range";
  async function canEdit(id: string) {
    if (id === ownerId) return true;
    return (
      (await db.user.findUnique({ where: { id }, select: { role: true } }))
        ?.role === "ADMIN"
    );
  }
  router.get(base + "/coverage", auth, (_req, res) => {
    res.set("Cache-Control", "private, no-store").json(coverage());
  });
  router.get(
    base + "/author",
    auth,
    asyncRoute(async (req: AuthedRequest, res) => {
      res.set("Cache-Control", "private, no-store");
      const rows = await db.$queryRaw<AuthorInfo[]>`
        SELECT COALESCE(profile.bio, '') AS bio, COALESCE(profile.links, '{}'::jsonb) AS links,
               COALESCE(profile.revision, 0) AS revision,
               (viewer.id = owner.id OR viewer.role = 'ADMIN') AS "canEdit"
        FROM "User" AS owner
        JOIN "User" AS viewer ON viewer.id = ${req.userId!}
        LEFT JOIN "ThomasAuthorProfile" AS profile ON profile."ownerId" = owner.id
        WHERE owner.id = ${ownerId}`;
      if (!rows.length) return res.status(404).json({error:"Автор не привязан"});
      res.json(rows[0]);
    }),
  );
  router.put(
    base + "/author",
    auth,
    asyncRoute(async (req: AuthedRequest, res) => {
      res.set("Cache-Control", "private, no-store");
      if (!ownerId) return res.status(404).json({ error: "Автор не привязан" });
      if (!(await canEdit(req.userId!)))
        return res
          .status(403)
          .json({ error: "Нет права изменять профиль автора" });
      const parsed = editor.safeParse(req.body);
      if (!parsed.success)
        return res.status(400).json({ error: "Проверьте описание и ссылки" });
      const { bio, revision } = parsed.data;
      const links: Partial<Record<Network, string>> = {};
      try {
        for (const [key, val] of Object.entries(parsed.data.links)) {
          if (!Object.prototype.hasOwnProperty.call(SOCIAL_NAMES, key))
            throw Error();
          if (val.trim())
            links[key as Network] = authorUrl(key as Network, val.trim());
        }
      } catch {
        return res
          .status(400)
          .json({
            error: "Укажите корректную публичную ссылку для выбранной сети",
          });
      }
      const body = JSON.stringify(links);
      const rows =
        revision === 0
          ? await db.$queryRaw<
              Stored[]
            >`INSERT INTO "ThomasAuthorProfile" ("ownerId",bio,links,revision) VALUES (${ownerId},${bio},${body}::jsonb,1) ON CONFLICT ("ownerId") DO NOTHING RETURNING bio,links,revision`
          : await db.$queryRaw<
              Stored[]
            >`UPDATE "ThomasAuthorProfile" SET bio=${bio},links=${body}::jsonb,revision=revision+1 WHERE "ownerId"=${ownerId} AND revision=${revision} RETURNING bio,links,revision`;
      if (!rows.length)
        return res
          .status(409)
          .json({
            error: "Профиль уже изменён. Обновите страницу перед сохранением.",
          });
      res.json({ ...rows[0], canEdit: true });
    }),
  );
  return router;
}
