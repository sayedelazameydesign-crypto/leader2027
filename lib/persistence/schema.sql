-- مخطط محوّل PostgreSQL — VS5/T1
-- مستند واحد للـStore (دلالات مطابقة لـfile-json: LWW على مستوى المستند).
CREATE TABLE IF NOT EXISTS l27_store (
  id         TEXT PRIMARY KEY,
  doc        JSONB NOT NULL,
  version    BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
