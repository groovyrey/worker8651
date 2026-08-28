CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO messages (name, text) VALUES
  ('Rey', 'First message from the edge!'),
  ('Demo', 'D1 + Workers = serverless SQLite');

CREATE TABLE IF NOT EXISTS groovyrey_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'Anonymous',
  text TEXT NOT NULL,
  ip TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_comments_created ON groovyrey_comments (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comments_ip_created ON groovyrey_comments (ip, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 1,
  window_start INTEGER NOT NULL,
  PRIMARY KEY (ip, key)
);
