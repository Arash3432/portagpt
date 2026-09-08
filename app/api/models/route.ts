import { jsonError, noStoreJson } from "../../../lib/http";
import { publicModelCatalog } from "../../../lib/models";
import { getSession } from "../../../lib/session";

export const runtime="nodejs";
export async function GET(request: Request){
  try{const session=await getSession(request);return noStoreJson({models:await publicModelCatalog(session?.plan||"free")});}
  catch{return jsonError("فهرست مدل‌ها فعلاً در دسترس نیست.",503);}
}
