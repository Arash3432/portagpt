import type { Metadata } from "next";
import { PortalModels } from "../ui/portal-models";

export const metadata: Metadata = {
  title: "مدل‌ها",
  description: "مدل‌های متنی، کدنویسی و تصویرسازی Portal AI را مقایسه کنید.",
};

export default function ModelsPage() {
  return <PortalModels />;
}
