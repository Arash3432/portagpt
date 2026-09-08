import type { Metadata, Viewport } from "next";
import "@fontsource-variable/vazirmatn";
import "./globals.css";
import "./refinement.css";
import "./design-system.css";

export const metadata: Metadata = {
  title: {
    default: "Portal AI — یک درگاه، بهترین مدل‌های هوش مصنوعی",
    template: "%s | Portal AI",
  },
  description:
    "دسترسی سریع، امن و یکپارچه به مدل‌های پیشرفته متن، کدنویسی و تصویرسازی.",
  applicationName: "Portal AI",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Portal AI",
  },
  formatDetection: { telephone: false },
  icons: {
    icon: "/portal-ai-logo.png",
    shortcut: "/portal-ai-logo.png",
    apple: "/portal-ai-logo.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  // Android Chrome: the keyboard shrinks the layout viewport so the composer
  // rides above it; iOS is handled via the visualViewport mirror in the app.
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0c1018" },
    { media: "(prefers-color-scheme: light)", color: "#f5f4f0" },
  ],
};

// Applies the saved theme + locale before first paint so the interface never
// flashes in the wrong direction, language, or palette (kill FOUC entirely).
const bootstrapScript = `(function(){try{var d=document.documentElement;d.classList.add("js");var c=localStorage.getItem("portal-theme-choice");var r=c==="light"||c==="dark"?c:c==="system"?(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):localStorage.getItem("portal-theme")==="light"?"light":"dark";d.dataset.theme=r;d.dataset.density=localStorage.getItem("portal-density")==="compact"?"compact":"comfortable";d.dataset.motion=localStorage.getItem("portal-reduce-motion")==="true"?"reduced":"full";var l=localStorage.getItem("portal-locale");if(l==="fa"||l==="en"||l==="ar"||l==="zh"){d.lang=l;d.dir=(l==="fa"||l==="ar")?"rtl":"ltr"}}catch(e){}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: bootstrapScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
