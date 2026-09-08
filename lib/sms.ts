import { getEnv, isProduction } from "./env";

export function isSmsConfigured() {
  const env = getEnv();
  return Boolean(env.SMS_API_URL && env.SMS_API_TOKEN);
}

export async function sendOtp(phone: string, code: string) {
  const env = getEnv();
  if (!env.SMS_API_URL || !env.SMS_API_TOKEN) {
    if (!isProduction() && env.OTP_DEV_CODE) return { development: true };
    throw new Error("SMS_NOT_CONFIGURED");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(env.SMS_API_URL, {
      method: "POST",
      signal: controller.signal,
      redirect: "error",
      headers: { "content-type": "application/json", [env.SMS_AUTH_HEADER]: `${env.SMS_AUTH_SCHEME} ${env.SMS_API_TOKEN}`.trim() },
      body: JSON.stringify({ receptor: phone, token: code, template: env.SMS_TEMPLATE }),
    });
    if (!response.ok) throw new Error("SMS_PROVIDER_FAILED");
    return { development: false };
  } finally { clearTimeout(timeout); }
}
