import type { Metadata } from "next";
import { PortalApp } from "../ui/portal-app";

export const metadata: Metadata = { title: "استودیوی تصویر", description: "ساخت تصویر با مدل‌های Portal AI" };

export default function StudioPage() {
  return <PortalApp initialType="image" />;
}
