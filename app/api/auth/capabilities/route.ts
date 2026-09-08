import { noStoreJson } from "../../../../lib/http";
import { isSmsConfigured } from "../../../../lib/sms";

export const runtime = "nodejs";

export async function GET() {
  return noStoreJson({
    passwordLogin: true,
    passwordRegistration: true,
    smsAvailable: isSmsConfigured(),
    defaultMethod: "password",
  });
}
