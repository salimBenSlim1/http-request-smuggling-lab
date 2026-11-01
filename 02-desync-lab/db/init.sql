-- Minimal schema for the desync lab's two backend instances.
-- Run: psql -U labuser -d labdb -f db/init.sql

CREATE TABLE IF NOT EXISTS users (
    id         SERIAL PRIMARY KEY,
    username   TEXT UNIQUE NOT NULL,
    password   TEXT NOT NULL,      -- plaintext on purpose: lab only, never do this in real code
    otp_secret TEXT NOT NULL,
    balance    INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS sessions (
    id           TEXT PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    verified     BOOLEAN NOT NULL DEFAULT FALSE,
    otp_attempts INTEGER NOT NULL DEFAULT 0,
    expires_at   TIMESTAMPTZ NOT NULL
);

-- Seed user: username "salim", password "correct-password", OTP "739421"
INSERT INTO users (username, password, otp_secret, balance)
VALUES ('salim', 'correct-password', '739421', 125000)
ON CONFLICT (username) DO NOTHING;
