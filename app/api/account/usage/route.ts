import { jsonError, noStoreJson } from "../../../../lib/http";
import { usageSnapshot } from "../../../../lib/quotas";
import { getSession } from "../../../../lib/session";

export const runtime="nodejs";
export async function GET(request: Request){try{const session=await getSession(request);if(!session)return jsonError("ورود لازم است.",401);return noStoreJson(await usageSnapshot(session.userId,session.plan));}catch{return jsonError("اطلاعات سهمیه در دسترس نیست.",503)}}
