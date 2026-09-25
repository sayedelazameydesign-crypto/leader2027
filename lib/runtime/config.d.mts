/** أنواع `lib/runtime/config.mjs` — تُستورد من `lib/auth/session.ts` (مصدر واحد للقاعدة). */

export declare const DEV_SESSION_SECRET: string;
export declare const MIN_SECRET_LENGTH: number;

export type SessionSecretIssue = "missing" | "too_short" | "dev_secret";

export declare function sessionSecretIssue(raw: string | undefined): SessionSecretIssue | null;
export declare function sessionSecretMessage(issue: SessionSecretIssue): string;
export declare function resolveSessionSecret(nodeEnv: string | undefined, raw: string | undefined): string;

export type RuntimeConfigInput = {
  isStart: boolean;
  nodeEnv: string | undefined;
  raw: string | undefined;
};

export declare function assertRuntimeConfig(input: RuntimeConfigInput): string | null;
export type BootCommand = "build" | "start" | "dev" | "unknown";

export declare function detectBootCommand(input: {
  argv?: unknown[];
  title?: string;
  env?: Record<string, string | undefined>;
}): BootCommand;

export declare function assertBootEnvironment(
  argv?: string[],
  env?: Record<string, string | undefined>,
  title?: string,
): string | null;
