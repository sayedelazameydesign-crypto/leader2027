-- مخطط محوّل PostgreSQL — VS5/T1
-- مستند واحد للـStore (دلالات مطابقة لـfile-json: LWW على مستوى المستند).
CREATE TABLE IF NOT EXISTS l27_store (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  version    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- مُخدد المعدل الموزَّع (lib/rate-limit.ts) — عدّاد نافذة ثابتة لكل مفتاح.
CREATE TABLE IF NOT EXISTS l27_rate (
  bucket_key   TEXT PRIMARY KEY,
  window_start BIGINT NOT NULL,
  count        BIGINT NOT NULL
);
