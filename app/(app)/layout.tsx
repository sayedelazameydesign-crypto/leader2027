import { requirePageUser } from "@/lib/auth/page";
import LogoutButton from "@/components/ui/LogoutButton";
import Link from "next/link";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user } = await requirePageUser();

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">L27</span>
          <div className="brand-text">
            <strong>Leader 2027</strong>
            <small>لوحة العمليات الانتخابية</small>
          </div>
        </div>
        <nav className="nav">
          <Link href="/">لوحة القيادة</Link>
          <Link href="/people">الأشخاص</Link>
          <Link href="/volunteers">المتطوعون</Link>
          <Link href="/field/reports">التقارير الميدانية</Link>
        </nav>
        <div className="userbox">
          <span className="chip chip-ok">
            {user.name} · {user.role}
          </span>
          <LogoutButton />
        </div>
      </header>
      <main className="wrap">{children}</main>
      <footer className="foot">© 2026 Leader 2027 — بيانات تشغيلية</footer>
    </>
  );
}
