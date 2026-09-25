/**
 * Smoke — إثبات production على خادم next start حقيقي (AC12-17).
 * صفر اعتمادات — fetch فقط. يعمل محلياً وفي CI.
 * BASE_URL افتراضي: http://127.0.0.1:3000
 */
const BASE = process.env.BASE_URL ?? "http://127.0.0.1:3000";
const results = [];

function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
}

async function req(path, opts = {}, cookie) {
  const res = await fetch(BASE + path, {
    ...opts,
    redirect: "manual",
    headers: { "content-type": "application/json", ...(opts.headers ?? {}), ...(cookie ? { cookie } : {}) },
  });
  const text = await res.text();
  return { res, text };
}

async function waitForServer() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const r = await fetch(BASE + "/api/health");
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((s) => setTimeout(s, 1000));
  }
  throw new Error("الخادم لم يستجب على " + BASE);
}

async function login(email) {
  const res = await fetch(BASE + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "Demo!2345" }),
  });
  if (!res.ok) throw new Error(`login failed: ${email} → ${res.status}`);
  const raw = res.headers.get("set-cookie") ?? "";
  const match = raw.match(/l27_session=([^;]+)/);
  if (!match) throw new Error("لا cookie جلسة");
  return `l27_session=${match[1]}`;
}

async function main() {
  await waitForServer();

  // حدود المصادقة (AC9): بلا جلسة
  {
    const { res } = await req("/");
    check("GET / بلا جلسة → تحويل لـ/login", res.status >= 300 && res.status < 400 && (res.headers.get("location") ?? "").includes("/login"), `status=${res.status}`);
  }
  {
    const { res } = await req("/api/people");
    check("GET /api/people بلا جلسة → 401", res.status === 401, `status=${res.status}`);
  }

  const coord = await login("coordinator@leader2027.test");
  const worker = await login("worker@leader2027.test");
  const viewer = await login("viewer@leader2027.test");

  // AC1: شاشة الأشخاص
  {
    const { res, text } = await req("/people", {}, coord);
    check("AC1: /people تعرض الدليل", res.status === 200 && text.includes("الأشخاص") && text.includes("أحمد محمود"), `status=${res.status}`);
  }

  // سيناريو §7: إنشاء شخص → Create Volunteer → تقرير ميداني
  const unique = `شخص smoke ${Date.now()}`;
  let personId;
  {
    const { res, text } = await req("/api/people", {
      method: "POST",
      body: JSON.stringify({ full_name: unique, source: "ميداني", region_id: "region-giza" }),
    }, coord);
    const data = JSON.parse(text);
    personId = data.person?.id;
    check("POST /api/people → 201 (إنشاء شخص)", res.status === 201 && !!personId, `status=${res.status}`);
  }
  {
    const { res, text } = await req(`/people/${personId}`, {}, coord);
    check("شاشة ملف الشخص تعرض الاسم", res.status === 200 && text.includes(unique), `status=${res.status}`);
  }

  let volId;
  {
    const { res, text } = await req("/api/volunteers", {
      method: "POST",
      body: JSON.stringify({ person_id: personId, team_id: "team-a" }),
    }, coord);
    const data = JSON.parse(text);
    volId = data.volunteer?.id;
    check("AC2: Create Volunteer → 201", res.status === 201 && !!volId, `status=${res.status}`);
  }
  {
    // طلب HTTP منفصل = محاكاة refresh (AC3/AC4)
    const { res, text } = await req(`/api/volunteers/${volId}`, {}, viewer);
    const data = JSON.parse(text);
    check("AC3/4: المتطوع يُسترجع بعد refresh (طلب منفصل)", res.status === 200 && data.volunteer?.person_id === personId, `status=${res.status}`);
  }
  {
    const { res, text } = await req(`/volunteers/${volId}`, {}, coord);
    check("شاشة /volunteers/[id] تحمّل", res.status === 200 && text.includes(unique), `status=${res.status}`);
  }

  // AC5/6: تقرير ميداني
  let before;
  {
    const { res, text } = await req("/api/stats", {}, worker);
    before = JSON.parse(text).kpis;
    check("GET /api/stats قبل → 200 (demo=false)", res.status === 200 && before !== undefined, `status=${res.status}`);
  }
  {
    const { res } = await req("/field/reports/new", {}, worker);
    check("شاشة /field/reports/new تعرض النموذج", res.status === 200, `status=${res.status}`);
  }
  let repId;
  {
    const { res, text } = await req("/api/field/reports", {
      method: "POST",
      body: JSON.stringify({
        region_id: "region-giza",
        team_id: "team-a",
        report_date: new Date().toISOString().slice(0, 10),
        activity: "نشاط smoke",
        people_contacted: 7,
        volunteers_present: 2,
      }),
    }, worker);
    const data = JSON.parse(text);
    repId = data.report?.id;
    check("AC5: Submit Report → 201", res.status === 201 && !!repId, `status=${res.status}`);
  }
  {
    const { res, text } = await req(`/api/field/reports/${repId}`, {}, worker);
    const data = JSON.parse(text);
    check("AC6: التقرير يُسترجع بقيمته (7 مُتصل بهم)", res.status === 200 && data.report?.people_contacted === 7, `status=${res.status}`);
  }
  {
    const { res, text } = await req(`/field/reports/${repId}`, {}, worker);
    check("شاشة /field/reports/[id] تحمّل", res.status === 200 && text.includes("نشاط smoke"), `status=${res.status}`);
  }

  // AC11: الـdashboard تعكس النشاط
  {
    const { res, text } = await req("/api/stats", {}, viewer);
    const after = JSON.parse(text).kpis;
    check("AC11: stats بعد التقرير: reports+1 وpeopleContacted+7", after.reports === before.reports + 1 && after.peopleContacted === before.peopleContacted + 7, `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    void res;
  }
  {
    const { res } = await req("/", {}, coord);
    check("AC11: لوحة القيادة تحمّل بعد النشاط", res.status === 200, `status=${res.status}`);
  }

  // AC7/8/9: رفض المرجعية الخاطئة والـpayload غير الصالح والعمليات غير المصرّح بها
  {
    const { res } = await req("/api/field/reports", {
      method: "POST",
      body: JSON.stringify({
        region_id: "region-giza", team_id: "nope",
        report_date: new Date().toISOString().slice(0, 10), activity: "نشاط",
      }),
    }, worker);
    check("AC7: team_id مجهول → 400", res.status === 400, `status=${res.status}`);
  }
  {
    const { res } = await req("/api/people", {
      method: "POST",
      body: JSON.stringify({ full_name: "", source: "" }),
    }, coord);
    check("AC8: payload غير صالح → 400", res.status === 400, `status=${res.status}`);
  }
  {
    const { res } = await req("/api/field/reports", {
      method: "POST",
      body: JSON.stringify({
        region_id: "region-giza", team_id: "team-a",
        report_date: new Date().toISOString().slice(0, 10), activity: "نشاط",
      }),
    }, viewer);
    check("AC9: Viewer يُمنع من إنشاء تقرير → 403", res.status === 403, `status=${res.status}`);
  }
  {
    const { res } = await req(`/api/people/${personId}`, {
      method: "PATCH",
      body: JSON.stringify({ full_name: "محاولة عامل" }),
    }, worker);
    check("AC9: Worker يُمنع من تعديل الأشخاص → 403", res.status === 403, `status=${res.status}`);
  }

  // ملخص
  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.detail ? `  [${r.detail}]` : ""}`);
  }
  console.log(`\nSMOKE RESULT: ${results.length - failed}/${results.length} passed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("SMOKE CRASHED:", e.message);
  process.exit(1);
});
