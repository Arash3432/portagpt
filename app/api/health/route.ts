import { db } from "../../../lib/db";
import { noStoreJson } from "../../../lib/http";
import { redisHealth } from "../../../lib/redis";
import packageJson from "../../../package.json";

export const runtime="nodejs";

// Reported by /api/health so a Liara deploy can be verified at a glance:
// the version shown here is exactly the build that is serving traffic.
const APP_VERSION = packageJson.version;

export async function GET(){
  let timeout:ReturnType<typeof setTimeout>|undefined;
  try{
    const deadline=new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error("HEALTH_TIMEOUT")),5_000);});
    // Database is load-bearing for every page and API; Redis backs rate
    // limiting and the image queue and reconnects on its own, so a transient
    // Redis blip must not fail the Liara health check (it reports honestly in
    // the body while the client keeps retrying in the background).
    const database=db()`select 1`.then(()=>"ok" as const);
    const cache=redisHealth();
    const probe=Promise.all([database,cache]);
    probe.catch(()=>undefined);
    const [databaseState,redisState]=await Promise.race([probe,deadline]);
    if(databaseState!=="ok") return noStoreJson({status:"not_ready",version:APP_VERSION,database:databaseState},503);
    return noStoreJson({status:redisState==="ok"?"ok":"degraded",version:APP_VERSION,database:"ok",redis:redisState});
  }catch{return noStoreJson({status:"not_ready",version:APP_VERSION},503)}finally{if(timeout)clearTimeout(timeout);}
}
