import type { Metadata } from "next";
import { LegalPage } from "../ui/legal-page";

export const metadata: Metadata = { title: "قوانین استفاده", robots: { index: true, follow: true } };
export default function TermsPage() { return <LegalPage type="terms" />; }
