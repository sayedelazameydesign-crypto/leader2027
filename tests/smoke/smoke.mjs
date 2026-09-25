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

  // ——— VS3: نواة الحملة الإدارية (12 فحصاً، production) ———
  {
    const ts = Date.now().toString().slice(-8);
    const owner = await login("owner@leader2027.test");
    const admin = await login("admin@leader2027.test");

    // 1: اسم الحملة (AC1/AC2) — PATCH ثم الشاشة تعرضه
    {
      const newName = `حملة smoke ${ts}`;
      const { res } = await req("/api/campaign", {
        method: "PATCH",
        body: JSON.stringify({ name: newName }),
      }, owner);
      const { res: pageRes, text } = await req("/admin", {}, owner);
      check("VS3-1: PATCH اسم الحملة والشاشة تعرضه (settings:manage)",
        res.status === 200 && pageRes.status === 200 && text.includes(newName),
        `patch=${res.status} page=${pageRes.status}`);
    }

    // 2: دورة انتخابية (AC3)
    {
      const { res, text } = await req("/api/cycles", {
        method: "POST",
        body: JSON.stringify({ name: `دورة smoke ${ts}`, election_date: "2027-06-01", status: "planned" }),
      }, owner);
      check("VS3-2: POST دورة انتخابية → 201", res.status === 201, `status=${res.status} body=${text.slice(0, 80)}`);
    }

    // 3: منطقة (AC4)
    {
      const { res } = await req("/api/regions", {
        method: "POST",
        body: JSON.stringify({ name: `منطقة smoke ${ts}` }),
      }, owner);
      check("VS3-3: POST منطقة → 201", res.status === 201, `status=${res.status}`);
    }

    // 4: فريق (AC4)
    {
      const { res } = await req("/api/teams", {
        method: "POST",
        body: JSON.stringify({ name: `فريق smoke ${ts}` }),
      }, owner);
      check("VS3-4: POST فريق → 201", res.status === 201, `status=${res.status}`);
    }

    // 5: مستخدم جديد (AC5) + 6: يدخل بحسابه
    const newUserEmail = `coord-${ts}@leader2027.test`;
    let newUserCookie = null;
    {
      const { res, text } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({
          name: `منسق smoke ${ts}`,
          email: newUserEmail,
          password: "Smoke!2345",
          role: "FIELD_COORDINATOR",
        }),
      }, owner);
      check("VS3-5: POST مستخدم جديد → 201 (بدون password_hash)",
        res.status === 201 && !text.includes("password_hash"), `status=${res.status}`);
    }
    {
      const loginRes = await fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: newUserEmail, password: "Smoke!2345" }),
      });
      const raw = loginRes.headers.get("set-cookie") ?? "";
      const match = raw.match(/l27_session=([^;]+)/);
      if (match) newUserCookie = `l27_session=${match[1]}`;
      check("VS3-6: دخول المستخدم المُنشأ", loginRes.ok && !!newUserCookie, `status=${loginRes.status}`);
    }

    // 7: Coordinator → 403 على settings وusers (AC7)
    {
      const { res: r1 } = await req("/api/regions", {
        method: "POST",
        body: JSON.stringify({ name: `منطقة منبوذة ${ts}` }),
      }, newUserCookie);
      const { res: r2 } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: "مس", email: `intruder-${ts}@leader2027.test`, password: "Demo!2345", role: "VIEWER" }),
      }, newUserCookie);
      check("VS3-7: Coordinator → 403 على settings وusers", r1.status === 403 && r2.status === 403, `settings=${r1.status} users=${r2.status}`);
    }

    // 8 (بند 21 «Admin دون إعدادات»): مستخدم دون settings/users:manage → 403 على campaign/users
    // تفسير مطابق للعقد المُقفَّل §4: settings:manage = OWNER/CAMPAIGN_ADMIN/CAMPAIGN_MANAGER
    // — «دون إعدادات» = بلا الإذنين (Viewer/Worker/Coordinator) → 403 على العائلتين.
    {
      const { res: c } = await req("/api/campaign", {
        method: "PATCH",
        body: JSON.stringify({ name: "منبوذ" }),
      }, viewer);
      const { res: u } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: "مس", email: `intruder3-${ts}@leader2027.test`, password: "Demo!2345", role: "VIEWER" }),
      }, viewer);
      check("VS3-8: دون settings/users:manage → 403 على campaign/users (بند 21)",
        c.status === 403 && u.status === 403, `campaign=${c.status} users=${u.status}`);
    }

    // 9: تغيير الاسم لا يطرد الجلسة (interpretation 4)
    {
      const { res: cr, text: ct } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: `اسمي ${ts}`, email: `named-${ts}@leader2027.test`, password: "Smoke!2345", role: "FIELD_WORKER" }),
      }, owner);
      const uid = JSON.parse(ct).user.id;
      const loginRes = await fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `named-${ts}@leader2027.test`, password: "Smoke!2345" }),
      });
      const raw = loginRes.headers.get("set-cookie") ?? "";
      const userCookie = raw.match(/l27_session=([^;]+)/)?.[0];
      const { res: pr } = await req(`/api/users/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ name: `اسمي الجديد ${ts}` }),
      }, owner);
      const { res: me } = await req("/api/stats", {}, userCookie);
      check("VS3-9: تغيير الاسم لا يطرد الجلسة", cr.status === 201 && pr.status === 200 && me.status === 200, `create=${cr.status} patch=${pr.status} stats=${me.status}`);
    }

    // 10: تغيير الدور يلغي الجلسات القديمة — session_epoch (AC6)
    {
      const { res: cr, text: ct } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: `دوري ${ts}`, email: `roled-${ts}@leader2027.test`, password: "Smoke!2345", role: "FIELD_COORDINATOR" }),
      }, owner);
      const uid = JSON.parse(ct).user.id;
      const loginRes = await fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: `roled-${ts}@leader2027.test`, password: "Smoke!2345" }),
      });
      const raw = loginRes.headers.get("set-cookie") ?? "";
      const oldCookie = raw.match(/l27_session=([^;]+)/)?.[0];
      const { res: pr } = await req(`/api/users/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ role: "FIELD_WORKER" }),
      }, owner);
      const { res: me } = await req("/api/stats", {}, oldCookie);
      check("VS3-10: تغيير الدور يُسقط الجلسة القديمة (401)", cr.status === 201 && pr.status === 200 && me.status === 401, `create=${cr.status} patch=${pr.status} stats=${me.status}`);
    }

    // 11: تعديل البريد/كلمة المرور مرفوض v1 (interpretation 3)
    {
      const { res: cr, text: ct } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: `ثابت ${ts}`, email: `fixed-${ts}@leader2027.test`, password: "Smoke!2345", role: "VIEWER" }),
      }, owner);
      const uid = JSON.parse(ct).user.id;
      const { res: er } = await req(`/api/users/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ email: "hack@x.test" }),
      }, owner);
      const { res: wr } = await req(`/api/users/${uid}`, {
        method: "PATCH",
        body: JSON.stringify({ password: "Hack!2345" }),
      }, owner);
      check("VS3-11: email/password غير قابلين للتعديل → 400", cr.status === 201 && er.status === 400 && wr.status === 400, `create=${cr.status} email=${er.status} pwd=${wr.status}`);
    }

    // 12: تحميلات فاسدة (AC8) → 400 + بريد مكرر → 409
    {
      const { res: bad } = await req("/api/cycles", {
        method: "POST",
        body: JSON.stringify({ name: `دورة فاسدة ${ts}`, election_date: "15-01-2027", status: "planned" }),
      }, owner);
      const { res: dup } = await req("/api/users", {
        method: "POST",
        body: JSON.stringify({ name: "مكرر", email: newUserEmail, password: "Demo!2345", role: "VIEWER" }),
      }, owner);
      check("VS3-12: تاريخ فاسد → 400 + بريد مكرر → 409", bad.status === 400 && dup.status === 409, `bad=${bad.status} dup=${dup.status}`);
    }
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
