-- Migration 0001: Initial schema
-- All tables for the Reverso CMS backend

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  body_md TEXT,
  thumbnail TEXT,
  hover_preview TEXT,
  service_types TEXT,
  client TEXT,
  date_mmddyyyy TEXT,
  year INTEGER,
  show_on_home INTEGER DEFAULT 0,
  "order" INTEGER DEFAULT 0,
  home_size TEXT DEFAULT '1x1',
  youtube_url TEXT,
  pixieset_url TEXT,
  published INTEGER DEFAULT 0,
  version INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_slug ON projects(slug);
CREATE INDEX IF NOT EXISTS idx_projects_published ON projects(published);
CREATE INDEX IF NOT EXISTS idx_projects_order ON projects("order");

CREATE TABLE IF NOT EXISTS admin_allowlist (
  github_id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revoked_sessions (
  jti TEXT PRIMARY KEY,
  revoked_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_github_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  diff_summary TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_login_ip_time ON login_attempts(ip, attempted_at);

CREATE TABLE IF NOT EXISTS deploy_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  triggered_at TEXT DEFAULT (datetime('now'))
);
