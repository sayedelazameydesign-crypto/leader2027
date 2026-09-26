/**
 * T4 — التحقق الحيّ (سبعة بنود؛ الآلي منها 1 · 2 · 3 · 6 · 7):
 *   node scripts/t4-verify.mjs https://<domain> [--wait-cold 5]
 * البنود 4 و5 يدويان في الطرفية (لا أسرار هنا):
 *   4) npx vercel env ls production | grep L27_RATE_BACKEND ⇒ يجب ألّا يوجد
 *   5) [[ "$DATABASE_URL" == *-pooler* ]] ⇒ yes (القيمة لا تُطبع أبدًا)
 * البند 3 (cold start): شغّل أولًا بلا --wait-cold، ثم أعد معه بعد الخمول.
 */
const BASE = (process.argv[2] ?? "").replace(/\/$/, "");
if (!BASE) {
  console.error("Usage: node scripts/t4-verify.mjs https://<domain> [--wait-cold 5]");
  process.exit(1);
}
const waitIdx = process.argv.indexOf("--wait-cold");
const waitMin = waitIdx > 0 ? Number(process.argv[waitIdx + 1]) : 0;

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  [${detail}]` : ""}`);
}

async function main() {
  // 1) إثبات x-real-ip — هل تكتبها الحافة فعلًا ومُنظَّفة؟
  const d = await fetch(`${BASE}/api/debug/headers`, { cache: "no-store" }).then((r) => r.json());
  const realIpOne = typeof d.realIp === "string" && d.realIp.length > 0 && !d.realIp.includes(",");
  check(
    "T4-1 x-real-ip مكتوبة ومُنظَّفة (بديل: x-vercel-forwarded-for)",
    realIpOne,
    JSON.stringify({ realIp: d.realIp, vercelFwd: d.vercelFwd, xff: d.xff }).slice(0, 160),
  );

  if (waitMin > 0) {
    console.log(`… انتظار ${waitMin} دقيقة لبدء cold start (بلا طلبات)`);
    await new Promise((r) => setTimeout(r, waitMin * 60_000));
  }

  // 2 + 3) 61 طلبًا بترويسات XFF مختلفة ⇒ الحد يبقى ⇒ الـ61 = 429
  // (الاستمرار بعد cold start = الحالة في القاعدة لا في ذاكرة النسخة).
  let last = 0;
  const first = await fetch(`${BASE}/api/debug/headers`, { cache: "no-store" });
  last = first.status;
  for (let i = 0; i < 61; i += 1) {
    const res = await fetch(`${BASE}/api/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${i}`, // يتحكم بها العميل — يجب ألّا تفتح دلاء
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    last = res.status;
    if (i < 60 && last !== 401 && last !== 429) {
      check(`T4-2/3 رد غير متوقع في الطلب ${i + 1}`, false, `HTTP ${last}`);
      break;
    }
    if (i === 60) {
      check(
        waitMin > 0 ? "T4-3 cold start: العدّ يستمر (61 ⇒ 429)" : "T4-2 XFF متغيّر لا يتجاوز الحد (61 ⇒ 429)",
        last === 429,
        `الطلب 61 = HTTP ${last}`,
      );
    }
  }

  // 6) كوكي الجلسة: Secure + HttpOnly + SameSite=lax
  const email = process.env.L27_T4_LOGIN_EMAIL;
  const password = process.env.L27_T4_LOGIN_PASSWORD;
  if (email && password) {
    const res = await fetch(`${BASE}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ email, password }),
    });
    const set = res.headers.get("set-cookie") ?? "";
    const ok =
      /Secure/i.test(set) && /HttpOnly/i.test(set) && /SameSite=lax/i.test(set);
    check("T4-6 كوكي الجلسة Secure+HttpOnly+SameSite=lax", ok, set.split(";").map((s) => s.trim().split("=")[0]).join(" | "));
  } else {
    check("T4-6 كوكي الجلسة (تخطَّ — اضبط L27_T4_LOGIN_EMAIL/PASSWORD)", false, "skipped");
  }

  // 7) smoke 49/49 ضد الحيّ — يُشغَّل من shell بنفس L27_DEMO_PASSWORD للبيئة.
  console.log("\nT4-7: شغّل:  BASE_URL=" + BASE + " L27_DEMO_PASSWORD=$pw npm run smoke");

  console.log("\n=== الملخص ===");
  for (const r of results) console.log(`${r.pass ? "✅" : "❌"} ${r.name}`);
  process.exit(results.every((r) => r.pass) ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
