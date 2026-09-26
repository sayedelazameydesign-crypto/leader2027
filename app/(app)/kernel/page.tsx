import Link from "next/link";
import { requirePageUser } from "@/lib/auth/page";
import { can } from "@/lib/authorization/policy";
import KernelBoard from "@/components/kernel/KernelBoard";

export const dynamic = "force-dynamic";

export default async function KernelPage() {
  const { user } = await requirePageUser();

  if (!can(user, "dashboard:view")) {
    return (
      <section className="dash">
        <h1>النواة الحيّة</h1>
        <p className="err">قراءة النواة تتطلب صلاحية عرض.</p>
        <Link href="/">→ لوحة القيادة</Link>
      </section>
    );
  }

  return (
    <>
      <section className="hero">
        <h1>النواة الحيّة — الأنوية الذرية</h1>
        <p>
          كل ركن في النظام نواة مكتفية ذاتيًا: تُعلن ما تُشبعه من قدرات وما تستهلكه من أحداث، ولها
          مَقابض تعديل تخصّها وحدها. التعديل هنا لا يحتاج إعادة نشر ولا يمسّ معمارية بقية الأركان.
        </p>
      </section>

      <KernelBoard canConfigure={can(user, "settings:manage")} canDecide={can(user, "users:manage")} />
    </>
  );
}
