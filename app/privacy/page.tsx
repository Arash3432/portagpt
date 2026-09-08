import type { Metadata } from "next";
import { LegalPage } from "../ui/legal-page";

export const metadata: Metadata = { title: "حریم خصوصی", robots: { index: true, follow: true } };
export default function PrivacyPage() { return <LegalPage type="privacy" />; }
