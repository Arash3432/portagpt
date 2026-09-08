import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../app/api/health/route";

test("health stays bounded during Redis reconnection and reports degraded state honestly", async () => {
  const priorSql = globalThis.__portalSql;
  const priorRedis = globalThis.__portalRedis;
  const priorConnect = globalThis.__portalRedisConnect;
  try {
    globalThis.__portalSql = (() => Promise.resolve([{ value: 1 }])) as unknown as NonNullable<typeof globalThis.__portalSql>;
    globalThis.__portalRedis = { isOpen: true, isReady: false } as NonNullable<typeof globalThis.__portalRedis>;
    globalThis.__portalRedisConnect = new Promise(() => {});
    const response = await Promise.race([GET(), new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error("health awaited the offline Redis reconnect")), 500); timer.unref(); })]);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "degraded", version: "1.7.1", database: "ok", redis: "unavailable" });
  } finally { globalThis.__portalSql = priorSql; globalThis.__portalRedis = priorRedis; globalThis.__portalRedisConnect = priorConnect; }
});

test("health requires the database and puts a cancellation deadline on Redis PING", async () => {
  const priorSql = globalThis.__portalSql;
  const priorRedis = globalThis.__portalRedis;
  let signal: AbortSignal | undefined;
  try {
    globalThis.__portalRedis = {
      isOpen: true, isReady: true,
      withAbortSignal(value: AbortSignal) { signal = value; return { ping: async () => "PONG" }; },
    } as unknown as NonNullable<typeof globalThis.__portalRedis>;
    globalThis.__portalSql = (() => Promise.resolve([])) as unknown as NonNullable<typeof globalThis.__portalSql>;
    const healthy = await GET();
    assert.equal(healthy.status, 200);
    assert.equal((await healthy.json()).status, "ok");
    assert.ok(signal instanceof AbortSignal);
    globalThis.__portalSql = (() => Promise.reject(new Error("private database failure"))) as unknown as NonNullable<typeof globalThis.__portalSql>;
    const failed = await GET();
    assert.equal(failed.status, 503);
    assert.equal((await failed.text()).includes("private database failure"), false);
  } finally { globalThis.__portalSql = priorSql; globalThis.__portalRedis = priorRedis; }
});
