import type { Metadata } from "next";
import { PortalPlans } from "../ui/portal-plans";

export const metadata: Metadata = {
  title: "اشتراک‌ها",
  description: "اشتراک‌های Portal AI را با قیمت، اعتبار تصویر و دسترسی مدل‌ها مقایسه کنید.",
};

export default function PlansPage() {
  return <PortalPlans />;
}
