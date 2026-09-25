import LiveDashboard from "../components/LiveDashboard";

export default function HomePage() {
  return (
    <>
      <header className="topbar">
        <div className="brand">
          <span className="mark">L27</span>
          <div className="brand-text">
            <strong>Leader 2027</strong>
            <small>لوحة القيادة</small>
          </div>
        </div>
        <span className="chip chip-neutral">الإصدار 0.1.0</span>
      </header>

      <main className="wrap">
        <section className="hero">
          <h1>كل بيانات منصتك في لوحة واحدة</h1>
          <p>
            Leader 2027 منصة إنتاجية لإدارة الحسابات والبيانات. هذه أول شريحة
            عمودية مكتملة: واجهة ← واجهة برمجية ← طبقة بيانات ← اختبارات ←
            جاهزية نشر.
          </p>
        </section>

        <LiveDashboard />

        <section className="card note">
          <h2>حالة الإصدار</h2>
          <ul>
            <li>واجهة لوحة القيادة (هذه الصفحة)</li>
            <li>
              <code>/api/health</code> و<code>/api/stats</code> تعملان فعلياً
            </li>
            <li>طبقة بيانات قابلة للاستبدال بقاعدة بيانات لاحقاً</li>
            <li>اختبارات وحدة لحساب المقاييس + فحص CI على كل push</li>
          </ul>
        </section>
      </main>

      <footer className="foot">© 2026 Leader 2027</footer>
    </>
  );
}
