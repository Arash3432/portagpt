import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { getEnv, isProduction } from "./env";

const digitMap: Record<string, string> = {
  "۰":"0", "۱":"1", "۲":"2", "۳":"3", "۴":"4", "۵":"5", "۶":"6", "۷":"7", "۸":"8", "۹":"9",
  "٠":"0", "١":"1", "٢":"2", "٣":"3", "٤":"4", "٥":"5", "٦":"6", "٧":"7", "٨":"8", "٩":"9",
};

export function normalizeIranianPhone(input: string): string | null {
  let value = input.trim().replace(/[۰-۹٠-٩]/g, (d) => digitMap[d]).replace(/[\s()-]/g, "");
  if (value.startsWith("0098")) value = `+98${value.slice(4)}`;
  if (value.startsWith("98")) value = `+${value}`;
  if (value.startsWith("09")) value = `+98${value.slice(1)}`;
  return /^\+989\d{9}$/.test(value) ? value : null;
}

export function maskPhone(phone: string) {
  return `${phone.slice(0, 5)}•••${phone.slice(-3)}`;
}

export function randomToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function randomOtp() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(value: string, pepper: string) {
  return createHmac("sha256", pepper).update(value).digest("hex");
}

export function safeEqualHex(a: string, b: string) {
  // Buffer.from(..., "hex") silently truncates malformed input. Validate first
  // so invalid/empty values can never compare as equal or throw on byte lengths.
  if (!a || a.length !== b.length || a.length % 2 !== 0 || !/^[a-f\d]+$/i.test(a) || !/^[a-f\d]+$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function safeEqualText(a: string, b: string) {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function normalizeIpAddress(value: string) {
  let candidate = value.trim();
  if (candidate.includes("%")) return null;
  if (candidate.startsWith("[") && candidate.endsWith("]")) candidate = candidate.slice(1, -1);
  if (isIP(candidate) === 4) return candidate;
  if (isIP(candidate) !== 6) return null;
  const mappedIpv4 = candidate.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i)?.[1];
  if (mappedIpv4 && isIP(mappedIpv4) === 4) return mappedIpv4;
  // URL serialization canonicalizes equivalent expanded/compressed IPv6 forms.
  const canonical = new URL(`http://[${candidate}]/`).hostname.slice(1, -1).toLowerCase();
  const mapped = canonical.match(/^::ffff:([a-f\d]{1,4}):([a-f\d]{1,4})$/i);
  if (mapped) {
    const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return canonical;
}

export function parseAdminIpAllowlist(value: string | null | undefined) {
  return (value || "")
    .split(",")
    .map((item) => normalizeIpAddress(item))
    .filter((item): item is string => Boolean(item));
}

export function isAdminIpAllowed(ip: string, configuredAllowlist: string | null | undefined) {
  // A blank value explicitly means "do not apply the optional network
  // restriction". Invalid non-blank values fail closed instead of becoming a
  // surprising wildcard or silently disabling the control.
  if (!configuredAllowlist?.trim()) return true;
  return parseAdminIpAllowlist(configuredAllowlist).includes(normalizeIpAddress(ip) || "");
}

// The administrator surface is intentionally fail-closed: in IP-only mode a
// missing or blank allowlist must never turn the control center into a public
// page. Keep isAdminIpAllowed's blank=true behavior for optional controls
// elsewhere in the application.
export function isAdminIpOnlyAllowed(ip: string, configuredAllowlist: string | null | undefined) {
  return Boolean(configuredAllowlist?.trim()) && isAdminIpAllowed(ip, configuredAllowlist);
}

export function getClientIp(request: Request) {
  return clientIpFromHeaders(request.headers, getEnv().TRUSTED_PROXY_HOPS);
}

export function clientIpFromHeaders(headers: Headers, hops: number) {
  if (!Number.isInteger(hops) || hops < 1 || hops > 5) return "unknown";
  const rawForwarded = headers.get("x-forwarded-for");
  if (rawForwarded !== null) {
    // Preserve every proxy slot: removing malformed entries shifts an attacker
    // controlled value into the trusted position. Never fall back on malformed
    // or incomplete forwarding chains, even when x-real-ip is present.
    const forwarded = rawForwarded.split(",");
    if (forwarded.length < hops) return "unknown";
    return normalizeIpAddress(forwarded[forwarded.length - hops]) || "unknown";
  }
  // A single trusted ingress may publish only x-real-ip. Multi-hop deployments
  // must supply the full chain and configure TRUSTED_PROXY_HOPS accurately.
  return hops === 1 ? normalizeIpAddress(headers.get("x-real-ip") || "") || "unknown" : "unknown";
}

export function assertSafeMutation(request: Request) {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === "cross-site") throw new Error("INVALID_ORIGIN");
  const origin = request.headers.get("origin");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (!origin) {
    if (isProduction()) throw new Error("INVALID_ORIGIN");
    return;
  }
  const allowed = new Set<string>();
  try { allowed.add(new URL(getEnv().PUBLIC_APP_URL).origin); } catch { /* configuration error handled elsewhere */ }
  if (host && !isProduction()) {
    allowed.add(`https://${host}`);
    if (!isProduction()) allowed.add(`http://${host}`);
  }
  if (!allowed.has(origin)) throw new Error("INVALID_ORIGIN");
}

export function hashIp(ip: string) {
  const pepper = getEnv().SESSION_PEPPER;
  return hmac(ip, pepper);
}
