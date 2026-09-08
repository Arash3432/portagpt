import type { Metadata } from "next";
import { AccountCenter } from "../ui/account-center";

export const metadata: Metadata = { title: "حساب من", description: "مدیریت اشتراک، مصرف و دستگاه‌های Portal AI" };

export default function AccountPage() {
  return <AccountCenter />;
}
