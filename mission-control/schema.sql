CREATE TABLE IF NOT EXISTS job_token_usage (
  id INTEGER PRIMARY KEY,
  job_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  total_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  note TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_token_usage_engine_created
  ON job_token_usage (engine, created_at);

CREATE INDEX IF NOT EXISTS idx_job_token_usage_job_id
  ON job_token_usage (job_id);
