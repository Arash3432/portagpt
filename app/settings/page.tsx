import type { Metadata } from "next";
import { SettingsCenter } from "../ui/settings-center";

export const metadata: Metadata = { title: "تنظیمات", description: "ظاهر، گفتگو و حساب Portal AI را تنظیم کنید." };

export default function SettingsPage() {
  return <SettingsCenter />;
}
