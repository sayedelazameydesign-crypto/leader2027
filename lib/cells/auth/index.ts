/**
 * نواة الهوية والجلسات — `auth`
 *
 * الركن: الدخول والجلسة.
 * تُشبع `auth.session` (استرجاع المستخدم من رمز) و`auth.login` (التحقق وإنشاء جلسة).
 *
 * مَقبضا التعديل يخصّان هذا الركن وحده: نطاق بريد مسموح، ومنع دخول الوكلاء.
 */
import { defineCell, type Actor } from "@/lib/kernel/types";
import { repos, stringSlot, ToolFailure } from "@/lib/kernel/bridge";
import { verifyPassword } from "@/lib/auth/password";
import { createSessionToken, readSessionToken } from "@/lib/auth/session";
import type { User } from "@/lib/repositories/interfaces";

export type SessionService = {
  /** المستخدم من رمز جلسة صالح (يتحقق من `session_epoch` — جلسات مُبطَلة تُرفض). */
  userFromToken(token: string): User | null;
  /** الشكل الآمن — لا `password_hash` إطلاقًا. */
  publicView(user: User): Omit<User, "password_hash">;
};

export type LoginService = {
  authenticate(email: string, password: string): { user: Omit<User, "password_hash">; token: string };
};

function publicView(user: User): Omit<User, "password_hash"> {
  const { password_hash: _drop, ...safe } = user;
  void _drop;
  return safe;
}

/** المستخدم من رمز — يتحقق من التوقيع والانتهاء و`session_epoch`. */
function userFromToken(token: string): User | null {
  const payload = readSessionToken(token);
  if (!payload) return null;
  const user = repos().users.getById(payload.uid);
  if (!user) return null;
  if (payload.ep !== user.session_epoch) return null;
  return user;
}

const authCell = defineCell({
  manifest: {
    id: "auth",
    version: "1.0.0",
    title: { ar: "نواة الهوية", en: "Identity Nucleus" },
    corner: "الهوية والجلسات",
    summary: {
      ar: "تتحقق من بيانات الدخول وتنشئ الجلسات وتقرأها، وترفض الجلسات المُبطَلة.",
      en: "Verifies credentials, issues and reads sessions, and rejects invalidated ones.",
    },
    provides: ["auth.session", "auth.login"],
    requires: [],
    emits: ["auth.login.succeeded", "auth.login.failed"],
    consumes: [],
    config: [
      {
        key: "allowed_email_domain",
        label: { ar: "نطاق البريد المسموح", en: "Allowed email domain" },
        default: "",
        effect: {
          ar: "إن كان غير فارغ فلا يُسمح بالدخول إلا لعناوين تنتهي بهذا النطاق (مثال: leader2027.test). فارغ = بلا قيد.",
          en: "When non-empty, only addresses ending with this domain may sign in (e.g. leader2027.test). Empty = unrestricted.",
        },
      },
      {
        key: "allow_agent_login",
        label: { ar: "السماح بدخول الوكلاء", en: "Allow agent sign-in" },
        default: false,
        effect: {
          ar: "عند التعطيل يُرفض أي طلب دخول من وكيل ذكاء اصطناعي — الوكلاء يعملون بجلسة بشرية مُصرَّح بها.",
          en: "When disabled, any sign-in request from an AI agent is refused — agents work under an approved human session.",
        },
      },
      {
        key: "expose_epoch",
        label: { ar: "إظهار رقم الجلسة", en: "Expose session epoch" },
        default: false,
        effect: {
          ar: "عند التمكين يُعاد `session_epoch` في مخرجات الدخول (يفيد كشف الإبطال في التشخيص).",
          en: "When enabled, `session_epoch` is returned on sign-in (useful for diagnosing invalidation).",
        },
      },
    ],
    tools: [
      {
        name: "auth.login",
        label: { ar: "دخول", en: "Sign in" },
        capability: "auth.login",
        risk: "write",
        input: { email: "string", password: "string" },
        // وكيل يطلب توكيل جلسة إنسان = عمل حسّاس يستلزم موافقة بشرية صريحة
        requiresApprovalForAgents: true,
      },
      {
        name: "auth.whoami",
        label: { ar: "من أنا", en: "Who am I" },
        capability: "auth.session",
        risk: "read",
        input: { token: "string" },
        requiresApprovalForAgents: false,
      },
    ],
  },

  services: {
    "auth.session": { userFromToken, publicView } satisfies SessionService,

    "auth.login": {
      authenticate(email: string, password: string) {
        const user = repos().users.getByEmail(String(email).trim().toLowerCase());
        if (!user) throw new ToolFailure("auth.invalid", "بيانات دخول غير صحيحة");
        if (!verifyPassword(String(password), user.password_hash)) {
          throw new ToolFailure("auth.invalid", "بيانات دخول غير صحيحة");
        }
        return {
          user: publicView(user),
          token: createSessionToken(user.id, user.session_epoch),
        };
      },
    } satisfies LoginService,
  },

  tools: {
    "auth.login": (ctx) => {
      // مَقبض 1: منع دخول الوكلاء إلا بتمكين صريح
      if (ctx.actor.kind === "agent" && ctx.config.allow_agent_login !== true) {
        throw new ToolFailure(
          "auth.agent_login_disabled",
          "دخول الوكلاء معطَّل في هذا الركن (allow_agent_login=false)",
        );
      }

      const email = String(ctx.input.email ?? "").trim().toLowerCase();
      const password = String(ctx.input.password ?? "");

      // مَقبض 2: نطاق البريد المسموح
      const domain = stringSlot(ctx.config.allowed_email_domain, "", 120).toLowerCase();
      if (domain.length > 0 && !email.endsWith(`@${domain}`)) {
        ctx.emit("auth.login.failed", { email, reason: "domain_not_allowed", domain });
        throw new ToolFailure("auth.domain", `الدخول مقصور على نطاق ${domain}`);
      }

      const login = ctx.require<LoginService>("auth.login");
      try {
        const result = login.authenticate(email, password);
        ctx.emit("auth.login.succeeded", {
          user_id: result.user.id,
          role: result.user.role,
          agent: ctx.actor.kind === "agent",
        });
        // expose_epoch=false (افتراضي): لا نكشف رقم الجلسة الداخلي للخارج
        if (ctx.config.expose_epoch === true) return result;
        const { session_epoch: _epoch, ...withoutEpoch } = result.user;
        void _epoch;
        return { user: withoutEpoch, token: result.token };
      } catch (err) {
        ctx.emit("auth.login.failed", { email, reason: "invalid_credentials" });
        throw err;
      }
    },

    "auth.whoami": (ctx) => {
      const session = ctx.require<SessionService>("auth.session");
      const user = session.userFromToken(String(ctx.input.token ?? ""));
      if (!user) throw new ToolFailure("auth.session_invalid", "جلسة غير صالحة أو مُبطَلة");
      return { user: session.publicView(user) };
    },
  },

  health() {
    try {
      const users = repos().users.list();
      return {
        ok: users.length > 0,
        detail:
          users.length > 0
            ? `المخزن متاح — ${users.length} مستخدمًا`
            : "لا مستخدمين في المخزن (seed لم يُهيَّأ؟)",
        at: new Date().toISOString(),
      };
    } catch (err) {
      return {
        ok: false,
        detail: `تعذّر الوصول للمخزن: ${err instanceof Error ? err.message : String(err)}`,
        at: new Date().toISOString(),
      };
    }
  },
});

export { authCell };
