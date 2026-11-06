const path = require("path");
const crypto = require("crypto");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

// Absolute path so the database file always lands in backend/, regardless of cwd.
const db = new Database(path.join(__dirname, "tasks.sqlite"));

// SQLite does not enforce foreign keys unless this is enabled per connection.
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    completed INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    due_date TEXT
  );
`);

// Migration: tasks predate multi-tenancy, so add user_id to existing databases.
const tableInfo = db.prepare("PRAGMA table_info(tasks)").all();
const hasUserId = tableInfo.some((col) => col.name === "user_id");

if (!hasUserId) {
  db.exec("ALTER TABLE tasks ADD COLUMN user_id INTEGER REFERENCES users(id);");
}

// Backfill: assign pre-migration tasks to a seed user so no rows are lost or orphaned.
const orphanCount = db
  .prepare("SELECT COUNT(*) AS count FROM tasks WHERE user_id IS NULL")
  .get().count;

if (orphanCount > 0) {
  const seedEmail = "default@email.com";
  let defaultUser = db.prepare("SELECT id FROM users WHERE email = ?").get(seedEmail);

  if (!defaultUser) {
    // Random password: the seed account only holds legacy tasks and is not meant for login.
    const passwordHash = bcrypt.hashSync(crypto.randomBytes(32).toString("hex"), 10);
    const result = db
      .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
      .run(seedEmail, passwordHash, new Date().toISOString());
    defaultUser = { id: result.lastInsertRowid };
  }

  db.prepare("UPDATE tasks SET user_id = ? WHERE user_id IS NULL").run(defaultUser.id);
}

module.exports = db;
