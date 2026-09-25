import type { Kpis } from "@/lib/domain/stats";

const CARDS: Array<{ key: keyof Kpis; label: string }> = [
  { key: "people", label: "الأشخاص" },
  { key: "volunteers", label: "المتطوعون النشطون" },
  { key: "reports", label: "التقارير الميدانية" },
  { key: "peopleContacted", label: "المُتصل بهم" },
  { key: "volunteersPresent", label: "حضور المتطوعين" },
];

export default function KpiCards({ kpis }: { kpis: Kpis }) {
  return (
    <section className="dash">
      <div className="dash-head">
        <h2>مؤشرات حية</h2>
        <span className="chip chip-ok">من النشاط المخزَّن — لا بيانات تجريبية</span>
      </div>
      <div className="grid">
        {CARDS.map((card) => (
          <article key={card.key} className="metric">
            <span className="label">{card.label}</span>
            <span className="value">{kpis[card.key]}</span>
          </article>
        ))}
      </div>
    </section>
  );
}
