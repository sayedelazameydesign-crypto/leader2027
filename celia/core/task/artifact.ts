/**
 * Celia · core/task · **المخرجات** (GEN-3): تُولَّد من خطوات VERIFIED فقط، وكل مخرج مربوط بـ stepId + actionId + رأس الدليل،
 * وتجزئته تُعاد حسابيًا في الإعادة. متاحة حتى لو انتهت المهمة PARTIAL أو BLOCKED — ما ثبت ثبت.
 */
import { canonicalJson, sha256Hex } from "../../nexa/index.ts";

export type Artifact = {
  id: string;
  taskId: string;
  stepId: string;
  type: string;
  /** مرجع عام (معرّف فعل البوابة الذي أنتج الملاحظة). */
  ref: string;
  /** رأس رسم الدليل لحظة الملاحظة. */
  evidenceHead: string;
  /** تجزئة المحتوى + الربط — تُعاد حسابيًا. */
  evidenceHash: string;
  createdAt: string;
  data: unknown;
};

export const artifactHash = (a: Omit<Artifact, "evidenceHash">): string => sha256Hex(canonicalJson({ id: a.id, taskId: a.taskId, stepId: a.stepId, type: a.type, ref: a.ref, evidenceHead: a.evidenceHead, data: a.data }));

export function makeArtifact(fields: Omit<Artifact, "evidenceHash">): Artifact {
  return { ...fields, evidenceHash: artifactHash(fields) };
}

export const verifyArtifact = (a: Artifact): boolean => artifactHash(a) === a.evidenceHash;

/** شكل عام بلا بيانات — للتقارير. */
export const publicArtifact = (a: Artifact): Omit<Artifact, "data"> & { size: number } => {
  const { data, ...rest } = a;
  return { ...rest, size: JSON.stringify(data ?? null).length };
};
