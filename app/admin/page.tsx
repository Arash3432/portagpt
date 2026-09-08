import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getEnv } from "../../lib/env";
import { getClientIp, isAdminIpOnlyAllowed } from "../../lib/security";
import { PortalAdmin } from "../ui/portal-admin";

export const metadata: Metadata = { title: "مدیریت", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function AdminPage() {
  const incoming = await headers();
  const requestHeaders = new Headers();
  incoming.forEach((value, key) => requestHeaders.set(key, value));
  const request = new Request("https://portalai.liara.run/admin", { headers: requestHeaders });
  if (!isAdminIpOnlyAllowed(getClientIp(request), getEnv().ADMIN_IP_ALLOWLIST)) notFound();
  return <PortalAdmin />;
}
