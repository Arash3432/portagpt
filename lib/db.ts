import postgres from "postgres";
import { getEnv } from "./env";

type SqlClient = ReturnType<typeof postgres>;

declare global {
  var __portalSql: SqlClient | undefined;
}

export function db(): SqlClient {
  if (!globalThis.__portalSql) {
    globalThis.__portalSql = postgres(getEnv().DATABASE_URL, {
      max: getEnv().DB_POOL_MAX,
      idle_timeout: 20,
      connect_timeout: 10,
      prepare: false,
      ssl: getEnv().DATABASE_SSL_MODE === "require" ? "require" : false,
      transform: { undefined: null },
    });
  }
  return globalThis.__portalSql;
}
