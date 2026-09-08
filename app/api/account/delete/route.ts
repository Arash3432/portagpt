import { z } from "zod";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson, parseJsonBody, requestError } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { clearSessionCookie, requireSession } from "../../../../lib/session";
import { deleteAllUserObjects } from "../../../../lib/storage";

export const runtime="nodejs";
export async function POST(request:Request){
  try{
    assertSafeMutation(request);const session=await requireSession(request);
    const parsed=z.object({confirmation:z.literal("DELETE")}).safeParse(await parseJsonBody(request,2_000));if(!parsed.success)return jsonError("برای حذف کامل، عبارت DELETE لازم است.",400);
    await deleteAllUserObjects(session.userId);
    const sql=db();await sql.begin(async(tx)=>{
      await tx`insert into account_deletion_requests(user_id,status,completed_at) values(${session.userId},'completed',now())`;
      await tx`delete from conversations where user_id=${session.userId}`;
      await tx`update files set status='deleted',deleted_at=now(),original_name='deleted' where user_id=${session.userId}`;
      await tx`update sessions set revoked_at=now() where user_id=${session.userId} and revoked_at is null`;
      await tx`delete from user_password_credentials where user_id=${session.userId}`;
      await tx`update users set phone_e164=concat('+deleted-',id::text),email=null,display_name=null,status='deleted',deleted_at=now(),updated_at=now() where id=${session.userId}`;
    });
    await clearSessionCookie();return noStoreJson({ok:true});
  }catch(error){const failure=requestError(error);if(failure)return failure;if(error instanceof Error&&error.message==='STORAGE_NOT_CONFIGURED')return jsonError("حذف کامل فایل‌ها فعلاً ممکن نیست؛ عملیات متوقف شد.",503);return jsonError("حذف حساب کامل نشد؛ ممکن است بخشی از فایل‌ها حذف شده باشند. دوباره تلاش کن یا با پشتیبانی تماس بگیر.",503)}
}
