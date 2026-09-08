import { z } from "zod";
import { db } from "../../../../../lib/db";
import { jsonError } from "../../../../../lib/http";
import { getSession } from "../../../../../lib/session";

export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request); if (!session) return jsonError("ورود لازم است.", 401);
    const { id } = await context.params; if (!z.string().uuid().safeParse(id).success) return jsonError("گفتگو پیدا نشد.", 404);
    const conv = await db()<Array<{ title: string; model_alias: string; created_at: string }>>`select title,model_alias,created_at from conversations where id=${id} and user_id=${session.userId} and deleted_at is null`;
    if (!conv.length) return jsonError("گفتگو پیدا نشد.", 404);
    const messages = await db()<Array<{ role: string; content: string; created_at: string }>>`select role,content,created_at from messages where conversation_id=${id} order by created_at`;
    const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "md";
    const safeName = conv[0].title.replace(/[^\p{L}\p{N} _-]/gu, "_").slice(0, 80);
    const encodedName=encodeURIComponent(safeName);
    if (format === "json") return new Response(JSON.stringify({ conversation: conv[0], messages }, null, 2), { headers: { "content-type": "application/json; charset=utf-8", "content-disposition": `attachment; filename="portal-chat.json"; filename*=UTF-8''${encodedName}.json`, "cache-control": "no-store", "x-content-type-options":"nosniff" } });
    const markdown = [`# ${conv[0].title}`, `Model: ${conv[0].model_alias}`, "", ...messages.flatMap((m) => [`## ${m.role === "user" ? "User" : "Portal AI"}`, "", m.content, ""])].join("\n");
    return new Response(markdown, { headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="portal-chat.md"; filename*=UTF-8''${encodedName}.md`, "cache-control": "no-store", "x-content-type-options":"nosniff" } });
  } catch { return jsonError("خروجی گفتگو ساخته نشد.", 503); }
}
