import { adminMutationError } from "../../../../lib/admin";
import { jsonError } from "../../../../lib/http";
import { assertSafeMutation } from "../../../../lib/security";
import { requireAdmin } from "../../../../lib/session";

export const runtime = "nodejs";

// IP-only administration has no password/OTP step-up flow. Keep this route
// as a compatibility response for old browser bundles, but never accept or
// process credentials here.
export async function POST(request: Request) {
  try {
    assertSafeMutation(request);
    await requireAdmin(request);
    return jsonError("تأیید دوباره در حالت دسترسی IP-only لازم نیست.", 409);
  } catch (error) {
    return adminMutationError(error, "تأیید دوباره در دسترس نیست.");
  }
}
