import Link from "next/link";
import { ArrowUpLeft, Compass } from "lucide-react";

export default function NotFound() {
  return (
    <main className="system-state">
      <section>
        <span><Compass size={16} /> 404</span>
        <h1>این صفحه پیدا نشد.</h1>
        <p>ممکن است آدرس تغییر کرده باشد یا صفحه دیگر در دسترس نباشد.</p>
        <Link className="public-primary" href="/">
          بازگشت به خانه <ArrowUpLeft size={18} />
        </Link>
      </section>
    </main>
  );
}
