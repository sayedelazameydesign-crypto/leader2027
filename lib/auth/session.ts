import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "l27_session";
const SECRET = process.env.L27_SESSION_SECRET ?? "l27-dev-secret-change-me";
const TTL_MS = 12 * 3600 * 1000;

type Payload = { uid: string; exp: number; ep: number };

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("hex");
}

export function createSessionToken(userId: string, sessionEpoch = 0): string {
  const payload: Payload = { uid: userId, exp: Date.now() + TTL_MS, ep: sessionEpoch };
  const body = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readSessionToken(token: string): Payload | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf-8")) as Payload;
    if (typeof payload.uid !== "string" || typeof payload.exp !== "number") return null;
    if (payload.exp < Date.now()) return null;
    if (typeof payload.ep !== "number") return null;
    return payload;
  } catch {
    return null;
  }
}
