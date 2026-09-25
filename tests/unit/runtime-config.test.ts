import { describe, it, expect } from "vitest";
import {
  DEV_SESSION_SECRET,
  MIN_SECRET_LENGTH,
  assertBootEnvironment,
  assertRuntimeConfig,
  detectBootCommand,
  resolveSessionSecret,
  sessionSecretIssue,
  sessionSecretMessage,
} from "@/lib/runtime/config.mjs";
import * as sessionFromAuth from "@/lib/auth/session";

/**
 * P2 — بوابة الإقلاع fail-closed كسلوك مُختبَر.
 *
 * ما تُثبته هذه الاختبارات هو القاعدة نفسها التي تُنفَّذ في `next.config.mjs`
 * عند `next start` — أما الإثبات على مستوى الخادم الحقيقي فخطوة CI
 * «P2 fail-closed proof» (خروج ≠ 0 + الرسالة في السجل).
 */

const VALID = "ci-only-secret-0123456789";

// قيم مُقاسة فعلياً على Next 16.3.6 (npm run build / npm start) — لا افتراضاً
const START_ARGV = ["/usr/local/bin/node", "/repo/node_modules/.bin/next", "start", "-H", "0.0.0.0"];
const START_TITLE = "next-server (v16.3.6)";
const START_ENV = { npm_lifecycle_script: "next start -H 0.0.0.0", npm_lifecycle_event: "start" };

const BUILD_ARGV = ["/usr/local/bin/node", "/repo/node_modules/.bin/next", "build"];
const BUILD_TITLE = "next-build (v16.3.6)";
const BUILD_ENV = { npm_lifecycle_script: "next build", npm_lifecycle_event: "build" };
// عمال jest-worker أثناء البناء: argv مختلف كلياً، لكن npm_lifecycle_event يبقى build
const BUILD_WORKER_ARGV = ["/usr/local/bin/node", "/repo/node_modules/next/dist/compiled/jest-worker/threadChild.js"];

const DEV_ARGV = ["/usr/local/bin/node", "/repo/node_modules/.bin/next", "dev"];
const DEV_TITLE = "next-dev (v16.3.6)";
const DEV_ENV = { npm_lifecycle_script: "next dev", npm_lifecycle_event: "dev" };

describe("P2 — assertRuntimeConfig (بوابة الإقلاع، نقية)", () => {
  it("next start + production بلا سرّ ⇒ رفض", () => {
    expect(() =>
      assertRuntimeConfig({ isStart: true, nodeEnv: "production", raw: undefined }),
    ).toThrow(/رفض الإقلاع \(fail-closed\)/);
  });

  it("next start + production + سرّ قصير/سرّ التطوير ⇒ رفض", () => {
    expect(() =>
      assertRuntimeConfig({ isStart: true, nodeEnv: "production", raw: "short" }),
    ).toThrow(new RegExp(`أقصر من ${MIN_SECRET_LENGTH}`));
    expect(() =>
      assertRuntimeConfig({ isStart: true, nodeEnv: "production", raw: DEV_SESSION_SECRET }),
    ).toThrow(/مساوٍ لسرّ التطوير/);
  });

  it("next start + production + سرّ صالح ⇒ يمر ويُعيد السرّ", () => {
    expect(assertRuntimeConfig({ isStart: true, nodeEnv: "production", raw: VALID })).toBe(VALID);
  });

  it("next start في التطوير/الاختبار ⇒ يمر بسرّ التطوير (بلا انحدار)", () => {
    expect(assertRuntimeConfig({ isStart: true, nodeEnv: "development", raw: undefined })).toBe(
      DEV_SESSION_SECRET,
    );
    expect(assertRuntimeConfig({ isStart: true, nodeEnv: "test", raw: undefined })).toBe(
      DEV_SESSION_SECRET,
    );
  });

  it("next build ⇒ لا يُطبق البوابة (السرّ لازم وقت التشغيل لا التجميع)", () => {
    expect(assertRuntimeConfig({ isStart: false, nodeEnv: "production", raw: undefined })).toBeNull();
  });
});

describe("P2 — detectBootCommand (استنتاج الأمر من حقيقة العملية)", () => {
  it("next start: من argv ومن npm script ومن process.title", () => {
    expect(detectBootCommand({ argv: START_ARGV, title: START_TITLE, env: START_ENV })).toBe("start");
    expect(detectBootCommand({ argv: [], title: "", env: START_ENV })).toBe("start");
    expect(detectBootCommand({ argv: [], title: START_TITLE, env: {} })).toBe("start");
  });

  it("next build: يُعرف حتى في عمال jest-worker (argv مختلف)", () => {
    expect(detectBootCommand({ argv: BUILD_ARGV, title: BUILD_TITLE, env: BUILD_ENV })).toBe("build");
    expect(detectBootCommand({ argv: BUILD_WORKER_ARGV, title: BUILD_TITLE, env: BUILD_ENV })).toBe("build");
  });

  it("next dev ومجهول", () => {
    expect(detectBootCommand({ argv: DEV_ARGV, title: DEV_TITLE, env: DEV_ENV })).toBe("dev");
    expect(detectBootCommand({ argv: ["node", "script.mjs"], title: "node", env: {} })).toBe("unknown");
  });
});

describe("P2 — assertBootEnvironment (قراءة حقيقة العملية)", () => {
  it("next start + NODE_ENV=production بلا سرّ ⇒ رفض", () => {
    expect(() => assertBootEnvironment(START_ARGV, { NODE_ENV: "production", ...START_ENV }, START_TITLE)).toThrow(
      /fail-closed/,
    );
    // يكفي argv وحده
    expect(() => assertBootEnvironment(START_ARGV, { NODE_ENV: "production" })).toThrow(/fail-closed/);
  });

  it("next start + سرّ صالح ⇒ يمر ويُعيد السرّ", () => {
    expect(
      assertBootEnvironment(START_ARGV, { NODE_ENV: "production", L27_SESSION_SECRET: VALID, ...START_ENV }, START_TITLE),
    ).toBe(VALID);
  });

  it("next build ⇒ لا رفض حتى على production بلا سرّ (بما فيه عمال البناء)", () => {
    expect(assertBootEnvironment(BUILD_ARGV, { NODE_ENV: "production", ...BUILD_ENV }, BUILD_TITLE)).toBeNull();
    expect(assertBootEnvironment(BUILD_WORKER_ARGV, { NODE_ENV: "production", ...BUILD_ENV }, BUILD_TITLE)).toBeNull();
  });

  it("next dev ⇒ البوابة لا تُطبق (null) ولا رفض — التطوير يعمل بسرّ التطوير", () => {
    expect(assertBootEnvironment(DEV_ARGV, { NODE_ENV: "development", ...DEV_ENV }, DEV_TITLE)).toBeNull();
    expect(resolveSessionSecret("development", undefined)).toBe(DEV_SESSION_SECRET);
  });
});

describe("P2 — رسائل الإصلاح + مصدر واحد للقاعدة", () => {
  it("لكل حالة رسالة عربية تُسمّي المتغير والسبب", () => {
    for (const issue of ["missing", "too_short", "dev_secret"] as const) {
      const msg = sessionSecretMessage(issue);
      expect(msg).toContain("L27_SESSION_SECRET");
      expect(msg).toContain("fail-closed");
    }
  });

  it("lib/auth/session يعيد تصدير نفس القاعدة (لا انحراف بين الطبقتين)", () => {
    expect(sessionFromAuth.DEV_SESSION_SECRET).toBe(DEV_SESSION_SECRET);
    expect(sessionFromAuth.MIN_SECRET_LENGTH).toBe(MIN_SECRET_LENGTH);
    expect(sessionFromAuth.resolveSessionSecret).toBe(resolveSessionSecret);
    expect(sessionFromAuth.sessionSecretIssue).toBe(sessionSecretIssue);
    expect(sessionFromAuth.sessionSecretIssue("abc")).toBe("too_short");
  });
});
