/**
 * NEXA — طبقة الحوكمة وثقة التنفيذ في Celia (GEN-0 Foundation).
 *
 *   AI → proposes · Policy → decides · Authorization → permits · Execution Authority → executes · Evidence → verifies
 *
 * هذه الحزمة نقية ومستقلة: لا تعتمد على Leader 2027 ولا على أي مزوّد. تُستورد داخل `celia/` فقط.
 */
export * from "./protocol.ts";
export * from "./capability.ts";
export * from "./policy.ts";
export * from "./authorization.ts";
export * from "./cost-guard.ts";
export * from "./execution.ts";
export * from "./evidence.ts";
export * from "./verification.ts";
