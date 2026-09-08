import { cookies } from "next/headers";
import { db } from "./db";
import { getEnv, isProduction } from "./env";
import { assertSafeMutation, getClientIp, hashIp, hmac, isAdminIpOnlyAllowed, maskPhone, randomToken, safeEqualHex, safeEqualText } from "./security";

const COOKIE_NAME = "portal_session";
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ADMIN_SESSION_SECONDS = 60 * 60 * 12;

export type PortalSession = {
  sessionId: string;
  userId: string;
  phoneE164: string;
  phoneMasked: string;
  plan: string;
  role: "user" | "admin" | "support";
  username?: string;
  displayName?: string;
  email?: string;
  csrfToken: string;
  adminVerifiedAt: string | null;
};

export function parseSessionCookie(value: string | undefined) {
  // Only the exact CSPRNG token format issued by createSession is accepted.
  // Malformed cookies should not consume a database connection on every page.
  if (!value || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{32}$/.test(value)) return null;
  const parts = value.split(".");
  const [token, csrf] = parts;
  return token && csrf ? { token, csrf } : null;
}

export async function createSession(userId: string, request: Request, adminVerified = false) {
  const sql = db();
  const token = randomToken();
  const csrf = randomToken(24);
  const env = getEnv();
  const tokenHash = hmac(token, env.SESSION_PEPPER);
  const csrfHash = hmac(csrf, env.SESSION_PEPPER);
  const userAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
  const maxAge = adminVerified ? ADMIN_SESSION_SECONDS : SESSION_SECONDS;
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  const [row] = await sql<{ id: string }[]>`
    insert into sessions (user_id, token_hash, csrf_hash, user_agent, expires_at, ip_hash, admin_verified_at)
    values (${userId}, ${tokenHash}, ${csrfHash}, ${userAgent}, ${expiresAt}, ${hashIp(getClientIp(request))}, ${adminVerified ? new Date() : null})
    returning id
  `;
  if (adminVerified) {
    await sql`update sessions set revoked_at=now() where user_id=${userId} and revoked_at is null and id<>${row.id}`;
  } else {
    await sql`
      update sessions set revoked_at=now()
      where user_id=${userId} and revoked_at is null and id not in (
        select id from sessions where user_id=${userId} and revoked_at is null
        order by created_at desc limit 10
      )
    `;
  }
  return { id: row.id, cookieValue: `${token}.${csrf}`, csrfToken: csrf, maxAge };
}

export async function setSessionCookie(value: string, maxAge = SESSION_SECONDS) {
  const jar = await cookies();
  jar.set(COOKIE_NAME, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "strict",
    path: "/",
    maxAge,
    priority: "high",
  });
}

export async function clearSessionCookie() {
  const jar = await cookies();
  jar.set(COOKIE_NAME, "", { httpOnly: true, secure: isProduction(), sameSite: "strict", path: "/", maxAge: 0 });
}

export async function getSession(request?: Request): Promise<PortalSession | null> {
  const jar = await cookies();
  const parsed = parseSessionCookie(jar.get(COOKIE_NAME)?.value);
  if (!parsed) return null;
  const env = getEnv();
  const tokenHash = hmac(parsed.token, env.SESSION_PEPPER);
  const rows = await db()<{
    session_id: string; user_id: string; phone_e164: string; email: string | null; display_name: string | null; username: string | null; role: PortalSession["role"];
    csrf_hash: string; plan_code: string | null; admin_verified_at: string | null; ip_hash: string | null; user_agent: string | null; last_seen_at: string;
  }[]>`
    select s.id as session_id, u.id as user_id, u.phone_e164, u.email, u.display_name, u.username, u.role, s.csrf_hash,s.admin_verified_at,
           s.ip_hash,s.user_agent,s.last_seen_at,
           coalesce(p.code, 'free') as plan_code
    from sessions s
    join users u on u.id = s.user_id
    left join subscriptions sub on sub.user_id = u.id and sub.status = 'active' and sub.ends_at > now()
    left join plans p on p.id = sub.plan_id
    where s.token_hash = ${tokenHash} and s.revoked_at is null and s.expires_at > now()
      and u.status = 'active'
    order by p.monthly_price_toman desc nulls last, sub.ends_at desc nulls last
    limit 1
  `;
  const row = rows[0];
  if (!row) return null;
  const presentedCsrfHash = hmac(parsed.csrf, env.SESSION_PEPPER);
  if (!safeEqualHex(presentedCsrfHash, row.csrf_hash)) return null;
  if (row.role === "admin" && request) {
    const currentIpHash = hashIp(getClientIp(request));
    const currentAgent = request.headers.get("user-agent")?.slice(0, 500) || null;
    const sameIp = Boolean(row.ip_hash) && safeEqualHex(currentIpHash, row.ip_hash || "");
    const sameAgent = Boolean(row.user_agent) && row.user_agent === currentAgent;
    const bindIp = env.ADMIN_SESSION_BIND_IP === "true";
    if ((bindIp && !sameIp) || !sameAgent) {
      await db().begin(async (tx) => {
        await tx`update sessions set revoked_at=now() where id=${row.session_id}`;
        await tx`insert into security_events(user_id,event_type,severity,ip_hash,details) values(${row.user_id},'admin_session_binding_mismatch','critical',${currentIpHash},${tx.json({ sameIp, sameAgent })})`;
      });
      return null;
    }
  }
  if (request && Date.now() - new Date(row.last_seen_at).getTime() > 5 * 60_000) {
    await db()`update sessions set last_seen_at=now() where id=${row.session_id} and revoked_at is null`;
  }
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    phoneE164: row.phone_e164,
    phoneMasked: maskPhone(row.phone_e164),
    plan: row.plan_code ?? "free",
    role: row.role,
    ...(row.username ? { username: row.username } : {}),
    ...(row.display_name ? { displayName: row.display_name } : {}),
    ...(row.email ? { email: row.email } : {}),
    csrfToken: parsed.csrf,
    adminVerifiedAt: row.admin_verified_at,
  };
}

export async function requireSession(request: Request) {
  assertSafeMutation(request);
  const session = await getSession(request);
  if (!session) throw new Error("UNAUTHORIZED");
  const csrf = request.headers.get("x-csrf-token") || "";
  if (!csrf || !safeEqualText(csrf, session.csrfToken)) throw new Error("INVALID_CSRF");
  return session;
}

export async function requireAdmin(request: Request) {
  const env = getEnv();
  const clientIp = getClientIp(request);
  if (!isAdminIpOnlyAllowed(clientIp, env.ADMIN_IP_ALLOWLIST)) throw new Error("ADMIN_IP_FORBIDDEN");

  // IP-only administration has no login session. We still resolve one real,
  // active admin row so existing audit and updated_by foreign keys remain
  // intact. The allowlist check above is the only access gate.
  const [admin] = await db()<Array<{
    id: string;
    phone_e164: string;
    email: string | null;
    display_name: string | null;
  }>>`
    select id,phone_e164,email,display_name
    from users
    where role='admin' and status='active'
    order by created_at asc
    limit 1
  `;
  if (!admin) throw new Error("ADMIN_USER_NOT_CONFIGURED");

  return {
    sessionId: "ip-only-admin",
    userId: admin.id,
    phoneE164: admin.phone_e164,
    phoneMasked: maskPhone(admin.phone_e164),
    plan: "free",
    role: "admin" as const,
    ...(admin.display_name ? { displayName: admin.display_name } : {}),
    ...(admin.email ? { email: admin.email } : {}),
    csrfToken: "",
    adminVerifiedAt: new Date().toISOString(),
  } satisfies PortalSession;
}

export async function requireElevatedAdmin(request: Request) {
  assertSafeMutation(request);
  const session = await requireAdmin(request);
  return session;
}

export async function markAdminElevated(sessionId: string) {
  await db()`update sessions set admin_verified_at=now(),last_seen_at=now() where id=${sessionId} and revoked_at is null and expires_at>now()`;
}
