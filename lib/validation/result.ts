export type FieldErrors = Record<string, string>;

export type Fail = {
  ok: false;
  status: 400 | 401 | 403 | 404 | 409;
  errors: FieldErrors;
};

export type Result<T> = { ok: true; value: T } | Fail;

export const ok = <T>(value: T): Result<T> => ({ ok: true, value });

export const fail = (
  status: Fail["status"],
  errors: FieldErrors,
): Fail => ({ ok: false, status, errors });

export const unauthorized = (): Fail =>
  fail(401, { _auth: "المصادقة مطلوبة" });

export const forbidden = (): Fail =>
  fail(403, { _auth: "عملية غير مصرّح بها" });

export const notFound = (key = "_form"): Fail =>
  fail(404, { [key]: "غير موجود" });

export const conflict = (errors: FieldErrors): Fail => fail(409, errors);
