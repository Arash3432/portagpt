import { z } from "zod";
import { db } from "../../../../lib/db";
import { requestError, jsonError, noStoreJson } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { getSession, requireSession } from "../../../../lib/session";
import { deleteConversationObjects } from "../../../../lib/storage";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession(request); if (!session) return jsonError("ورود لازم است.", 401);
    const { id } = await context.params; if (!z.string().uuid().safeParse(id).success) return jsonError("گفتگو پیدا نشد.", 404);
    const conversations = await db()<Array<{ id: string; title: string; model_alias: string; created_at: string; updated_at: string }>>`select id,title,model_alias,created_at,updated_at from conversations where id=${id} and user_id=${session.userId} and deleted_at is null`;
    if (!conversations.length) return jsonError("گفتگو پیدا نشد.", 404);
    const messages = await db()<Array<{ id: string; role: string; content: string; model_alias: string | null; created_at: string; file_id:string|null }>>`
      select m.id,m.role,m.content,m.model_alias,m.created_at,
        (select mf.file_id from message_files mf join files f on f.id=mf.file_id where mf.message_id=m.id and f.kind='generated' and f.deleted_at is null limit 1) as file_id
      from messages m where m.conversation_id=${id} order by m.created_at
    `;
    return noStoreJson({ conversation: conversations[0], messages });
  } catch { return jsonError("گفتگو در دسترس نیست.", 503); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSafeMutation(request); const session = await requireSession(request); const { id } = await context.params;
    if (!z.string().uuid().safeParse(id).success) return jsonError("گفتگو پیدا نشد.", 404);
    const sql=db();const owned=await sql<Array<{id:string}>>`select id from conversations where id=${id} and user_id=${session.userId} and deleted_at is null`;if(!owned.length)return jsonError("گفتگو پیدا نشد.",404);
    const fileIds=await deleteConversationObjects(session.userId,id);
    await sql.begin(async(tx)=>{await tx`update conversations set deleted_at=now(),updated_at=now() where id=${id} and user_id=${session.userId} and deleted_at is null`;if(fileIds.length)await tx`update files set status='deleted',deleted_at=now(),updated_at=now() where user_id=${session.userId} and id in ${tx(fileIds)}`;});
    return noStoreJson({ ok: true });
  } catch (error) {
    const failure = requestError(error);
    if (failure) return failure;
    if (error instanceof Error && error.message === "UNAUTHORIZED") return jsonError("ورود لازم است.", 401);
    return jsonError("حذف گفتگو انجام نشد.", 503);
  }
}
