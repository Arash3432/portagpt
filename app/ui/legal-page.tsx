"use client";

import { ArrowUpLeft, FileText, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { PublicShell } from "./public-shell";
import { tr } from "./i18n";

export function LegalPage({ type }: { type: "privacy" | "terms" }) {
  const isPrivacy = type === "privacy";
  return (
    <PublicShell>
      {(locale) => {
        const t = tr(locale);
        const page = isPrivacy ? t.legal.privacy : t.legal.terms;
        const sections = page.sections;
        return (
          <section className="legal-page public-container">
            <header data-reveal>
              <span>{isPrivacy ? <ShieldCheck size={23} /> : <FileText size={23} />}</span>
              <small>{page.label}</small>
              <h1>{page.title}</h1>
              <p>{page.intro}</p>
              <em>{t.legal.updatedLabel}: {t.legal.updatedDate}</em>
            </header>
            <div className="legal-sections">
              {sections.map(([title, body], index) => (
                <article key={title} data-reveal style={{ "--reveal-delay": `${index * 60}ms` } as React.CSSProperties}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <div>
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </div>
                </article>
              ))}
            </div>
            <aside data-reveal>
              <div>
                <b>{t.legal.askTitle}</b>
                <p>{t.legal.askBody}</p>
              </div>
              <a className="public-primary" href="mailto:support@portal-ai.ir">
                {t.legal.contact}<ArrowUpLeft size={17} />
              </a>
            </aside>
            <Link className="text-link" href="/">
              {t.legal.backHome}<ArrowUpLeft size={16} />
            </Link>
          </section>
        );
      }}
    </PublicShell>
  );
}
