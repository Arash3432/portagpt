import { db } from "./db";
import { redis } from "./redis";
import { getClientIp, hashIp } from "./security";

export async function flagAbuse(userId: string, eventType: string, request: Request, weight = 1) {
  const client = await redis(); const key = `abuse:${userId}`;
  const score = await client.incrBy(key, weight); if (score === weight) await client.expire(key, 3600);
  if (score < 20) return { suspended: false, score };
  const sql = db();
  await sql.begin(async (tx) => {
    await tx`update users set status='suspended',suspended_reason='automatic_security_review',updated_at=now() where id=${userId} and status='active'`;
    await tx`update sessions set revoked_at=now() where user_id=${userId} and revoked_at is null`;
    await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${userId},${eventType},'critical',${hashIp(getClientIp(request))},${sql.json({score,windowSeconds:3600})})`;
  });
  return { suspended: true, score };
}
