import { createClient, type RedisClientType } from "redis";
import { getEnv } from "./env";

declare global {
  var __portalRedis: RedisClientType | undefined;
  var __portalRedisConnect: Promise<void> | undefined;
}

export async function redis(): Promise<RedisClientType> {
  if (!globalThis.__portalRedis) {
    globalThis.__portalRedis = createClient({ url: getEnv().REDIS_URL, socket: { reconnectStrategy: (retries) => Math.min(retries * 100, 3000) } });
    globalThis.__portalRedis.on("error", () => undefined);
  }
  if (!globalThis.__portalRedis.isReady) {
    if (!globalThis.__portalRedisConnect) {
      globalThis.__portalRedisConnect = (globalThis.__portalRedis.isOpen
        ? Promise.resolve()
        : globalThis.__portalRedis.connect().then(() => undefined)
      ).finally(() => { globalThis.__portalRedisConnect = undefined; });
    }
    await globalThis.__portalRedisConnect;
  }
  return globalThis.__portalRedis;
}

// Health probes must not await the reconnect promise or join an offline
// command queue indefinitely. Normal rate limiting still requires Redis.
export async function redisHealth(): Promise<"ok" | "unavailable"> {
  const client = globalThis.__portalRedis;
  if (!client?.isReady) {
    if (!client?.isOpen && !globalThis.__portalRedisConnect) void redis().catch(() => undefined);
    return "unavailable";
  }
  try {
    await client.withAbortSignal(AbortSignal.timeout(1_000)).ping();
    return "ok";
  } catch { return "unavailable"; }
}

export async function rateLimit(key: string, limit: number, windowSeconds: number) {
  const client = await redis();
  const fullKey = `rl:${key}`;
  const result = await client.eval(
    `local count=redis.call('INCR',KEYS[1])
     if count==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end
     local ttl=redis.call('TTL',KEYS[1])
     if ttl<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]);ttl=tonumber(ARGV[1]) end
     return {count,ttl}`,
    { keys: [fullKey], arguments: [String(windowSeconds)] },
  ) as [number, number];
  const count = Number(result[0]); const ttl = Number(result[1]);
  return { allowed: count <= limit, remaining: Math.max(0, limit - count), retryAfter: Math.max(1, ttl) };
}

export async function clearRateLimit(...keys: string[]) {
  if (!keys.length) return;
  const client = await redis();
  await client.del(keys.map((key) => `rl:${key}`));
}

export async function consumeOtpAttempt(key: string, expectedHash: string, expectedSalt: string, matches: boolean) {
  const client = await redis();
  const result = await client.eval(
    `local hash=redis.call('HGET',KEYS[1],'hash')
     local salt=redis.call('HGET',KEYS[1],'salt')
     if not hash or not salt then return -1 end
     if hash~=ARGV[1] or salt~=ARGV[2] then return -2 end
     local attempts=tonumber(redis.call('HGET',KEYS[1],'attempts') or '0')
     if attempts>=5 then redis.call('DEL',KEYS[1]);return 0 end
     if ARGV[3]=='1' then
       local consumed=redis.call('SET',KEYS[1]..':used','1','NX','EX',300)
       if not consumed then return -3 end
       redis.call('DEL',KEYS[1]);return 1
     end
     attempts=attempts+1
     if attempts>=5 then redis.call('DEL',KEYS[1]) else redis.call('HSET',KEYS[1],'attempts',attempts) end
     return 0`,
    { keys: [key], arguments: [expectedHash, expectedSalt, matches ? "1" : "0"] },
  );
  return Number(result);
}
