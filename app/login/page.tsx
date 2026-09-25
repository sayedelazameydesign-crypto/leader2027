import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRepos } from "@/lib/repositories/container";
import { getSessionUser } from "@/lib/auth/request";
import { SESSION_COOKIE } from "@/lib/auth/session";
import LoginForm from "@/components/ui/LoginForm";

export default async function LoginPage() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value ?? null;
  const user = getSessionUser(getRepos(), token);
  if (user) redirect("/");

  return (
    <main className="login-wrap">
      <section className="dash login-card">
        <div className="brand">
          <span className="mark">L27</span>
          <div className="brand-text">
            <strong>Leader 2027</strong>
            <small>لوحة العمليات الانتخابية</small>
          </div>
        </div>
        <h1>تسجيل الدخول</h1>
        <LoginForm />
        <p className="muted small">
          حسابات تشغيلية تجريبية: manager@leader2027.test — coordinator@ — worker@ —
          viewer@ (كلمة المرور: Demo!2345)
        </p>
      </section>
    </main>
  );
}
