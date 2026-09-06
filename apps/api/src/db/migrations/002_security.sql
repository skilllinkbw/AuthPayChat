-- Rotation safety: remember the previous refresh-token hash so a replay can be detected
-- (a replayed token means the token leaked — every session for that user is revoked).
ALTER TABLE sessions ADD COLUMN previous_refresh_token_hash TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_prev_refresh ON sessions(previous_refresh_token_hash);
