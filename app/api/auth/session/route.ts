import { noStoreJson } from "../../../../lib/http";
import { getSession } from "../../../../lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const session = await getSession(request);
    if (!session) return noStoreJson({ user: null, csrfToken: null });
    return noStoreJson({
      user: { id: session.userId, phoneMasked: session.phoneMasked, email: session.email, plan: session.plan, role: session.role, ...(session.username ? { username: session.username } : {}), ...(session.displayName ? { displayName: session.displayName } : {}) },
      csrfToken: session.csrfToken,
    });
  } catch {
    return noStoreJson({ user: null, csrfToken: null }, 503);
  }
}
