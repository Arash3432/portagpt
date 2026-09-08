// Portal AI — نام کاربری کوتاه و خوانا به‌جای شماره موبایل در رابط کاربری.
// قواعد: ۳ تا ۲۴ نویسه، شروع با حرف لاتین، فقط حرف/عدد/زیرخط.

const USERNAME_PATTERN = /^[A-Za-z][A-Za-z0-9_]{2,23}$/;

const RESERVED_USERNAMES = new Set([
  "admin", "administrator", "support", "help", "security", "moderator",
  "portal", "portalai", "portal_ai", "root", "system", "official",
  "staff", "team", "api", "me", "you", "null", "undefined", "about",
]);

export function normalizeUsername(input: string): string | null {
  const value = input.trim().normalize("NFKC");
  if (!USERNAME_PATTERN.test(value)) return null;
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return null;
  return value;
}

export function generateUsername(): string {
  return `User${Math.floor(10000 + Math.random() * 90000)}`;
}

export function generateUniqueUsername(isTaken: (candidate: string) => Promise<boolean>): Promise<string> {
  const attempt = async (remaining: number): Promise<string> => {
    const candidate = generateUsername();
    if (!(await isTaken(candidate))) return candidate;
    if (remaining <= 1) return `User${Math.floor(100000 + Math.random() * 900000)}`;
    return attempt(remaining - 1);
  };
  return attempt(5);
}

export type UsernamePolicyError =
  | "USERNAME_INVALID"
  | "USERNAME_RESERVED"
  | "USERNAME_TAKEN";

export function usernamePolicyError(raw: string): UsernamePolicyError | null {
  const value = raw.trim().normalize("NFKC");
  if (!/^[A-Za-z][A-Za-z0-9_]{2,23}$/.test(value)) return "USERNAME_INVALID";
  if (RESERVED_USERNAMES.has(value.toLowerCase())) return "USERNAME_RESERVED";
  return null;
}
