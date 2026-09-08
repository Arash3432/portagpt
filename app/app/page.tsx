import type { Metadata } from "next";
import { PortalApp } from "../ui/portal-app";

export const metadata: Metadata = {
  title: "فضای کار",
  description: "فضای یکپارچه گفتگو، کدنویسی، فایل و تصویرسازی Portal AI",
};

export default function AppPage() {
  return <PortalApp />;
}
