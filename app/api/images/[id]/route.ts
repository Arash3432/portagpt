import { z } from "zod";
import { db } from "../../../../lib/db";
import { jsonError, noStoreJson } from "../../../../lib/http";
import { getSession } from "../../../../lib/session";

export const runtime="nodejs";
export async function GET(request:Request,context:{params:Promise<{id:string}>}){try{const session=await getSession(request);if(!session)return jsonError("ورود لازم است.",401);const {id}=await context.params;if(!z.string().uuid().safeParse(id).success)return jsonError("درخواست پیدا نشد.",404);const rows=await db()<Array<{status:string;file_id:string|null;revised_prompt:string|null;error_code:string|null}>>`select status,file_id,revised_prompt,error_code from image_jobs where request_id=${id} and user_id=${session.userId}`;const job=rows[0];if(!job)return jsonError("درخواست پیدا نشد.",404);return noStoreJson({id,status:job.status,url:job.file_id?`/api/assets/${job.file_id}`:null,revisedPrompt:job.revised_prompt,error:job.status==='failed'?'ساخت تصویر انجام نشد و اعتبار آزاد شد.':null});}catch{return jsonError("وضعیت تصویر در دسترس نیست.",503)}}
