import { domainToASCII } from "node:url";
import { db } from "./db";
import { maskPhone } from "./security";
import { createSession, setSessionCookie } from "./session";

export type AuthUser = { id: string; role: "user" | "admin" | "support"; status: string; display_name?: string | null; username?: string | null };

export function normalizeEmail(input: string): string | null {
  const value = input.trim().normalize("NFKC").toLocaleLowerCase("en-US");
  if (value.length < 3 || value.length > 254 || /\s/.test(value)) return null;
  const at = value.lastIndexOf("@");
  if (at < 1 || at !== value.indexOf("@")) return null;
  const local = value.slice(0, at);
  const asciiDomain = domainToASCII(value.slice(at + 1));
  if (!asciiDomain || local.length > 64 || local.startsWith(".") || local.endsWith(".") || local.includes("..")) return null;
  if (!/^[^<>(),;:\\"\[\]]+$/.test(local)) return null;
  if (asciiDomain.length > 253 || !asciiDomain.includes(".")) return null;
  if (!asciiDomain.split(".").every((label) => /^(?!-)[a-z0-9-]{1,63}(?<!-)$/.test(label))) return null;
  return `${local}@${asciiDomain}`;
}

export async function completeAuthentication(user: AuthUser, phone: string, request: Request, adminVerified = false) {
  const [plan] = await db()<Array<{ code: string }>>`
    select coalesce(p.code,'free') as code from users u
    left join subscriptions s on s.user_id=u.id and s.status='active' and s.ends_at>now()
    left join plans p on p.id=s.plan_id where u.id=${user.id}
    order by p.monthly_price_toman desc nulls last,s.ends_at desc nulls last limit 1
  `;
  const session = await createSession(user.id, request, adminVerified);
  await setSessionCookie(session.cookieValue, session.maxAge);
  return {
    user: {
      id: user.id,
      phoneMasked: maskPhone(phone),
      plan: plan?.code || "free",
      role: user.role,
      ...(user.username ? { username: user.username } : {}),
      ...(user.display_name ? { displayName: user.display_name } : {}),
    },
    csrfToken: session.csrfToken,
  };
}
