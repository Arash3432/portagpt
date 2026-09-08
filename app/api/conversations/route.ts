import { z } from "zod";
import { db } from "../../../lib/db";
import { jsonError, noStoreJson } from "../../../lib/http";
import { getSession } from "../../../lib/session";

export const runtime = "nodejs";
const querySchema = z.object({ q: z.string().max(100).default(""), cursor: z.string().datetime().optional() });

export async function GET(request: Request) {
  try {
    const session = await getSession(request); if (!session) return jsonError("ورود لازم است.", 401);
    const url = new URL(request.url); const parsed = querySchema.safeParse({ q: url.searchParams.get("q") || "", cursor: url.searchParams.get("cursor") || undefined });
    if (!parsed.success) return jsonError("جستجو معتبر نیست.", 400);
    const search = `%${parsed.data.q.replace(/[%_]/g, "\\$&")}%`;
    const rows = await db()<Array<{ id: string; title: string; model_alias: string; pinned: boolean; updated_at: string }>>`
      select id,title,model_alias,pinned,updated_at from conversations
      where user_id=${session.userId} and deleted_at is null and archived_at is null
        and (${parsed.data.q}='' or title ilike ${search})
        and (${parsed.data.cursor || null}::timestamptz is null or updated_at < ${parsed.data.cursor || null}::timestamptz)
      order by pinned desc,updated_at desc limit 30
    `;
    return noStoreJson({ conversations: rows, nextCursor: rows.length === 30 ? rows.at(-1)?.updated_at : null });
  } catch { return jsonError("گفتگوها در دسترس نیستند.", 503); }
}
