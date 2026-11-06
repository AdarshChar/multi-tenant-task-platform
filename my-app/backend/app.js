const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { signToken, requireAuth } = require("./middleware/auth");
const { createRateLimiter } = require("./middleware/rateLimiter");

const app = express();
const PORT = process.env.PORT || 3001;

// Local dev origins for the Vite frontend.
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

// Uncomment when running behind a reverse proxy or load balancer so req.ip is the client's IP.
// app.set("trust proxy", 1);

app.use(cors({ origin: ALLOWED_ORIGINS }));
app.use(express.json());

function mapTaskRow(row) {
  return {
    id: String(row.id),
    title: row.title,
    description: row.description ?? "",
    completed: Boolean(row.completed),
    createdAt: row.created_at,
    dueDate: row.due_date,
    userId: row.user_id,
  };
}

// Prepared statements. Every task query is scoped by user_id, so a valid token
// can never read or modify another user's rows (prevents IDOR).
const findUserByEmail = db.prepare("SELECT * FROM users WHERE email = ?");
const insertUser = db.prepare(
  "INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)"
);

const selectUserTasks = db.prepare(
  "SELECT * FROM tasks WHERE user_id = ? ORDER BY datetime(created_at) DESC"
);
const selectTaskByIdAndUser = db.prepare(
  "SELECT * FROM tasks WHERE id = ? AND user_id = ?"
);
const insertTask = db.prepare(
  "INSERT INTO tasks (title, description, completed, created_at, due_date, user_id) VALUES (?, ?, 0, ?, ?, ?)"
);
const updateTaskFull = db.prepare(
  "UPDATE tasks SET title = ?, description = ?, due_date = ?, completed = ? WHERE id = ? AND user_id = ?"
);
const deleteTaskByIdAndUser = db.prepare(
  "DELETE FROM tasks WHERE id = ? AND user_id = ?"
);

// Strict limit on public auth routes, keyed by IP, to slow down credential stuffing.
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 5,
  keyGenerator: (req) => `ip:${req.ip}`,
  message: "Too many authentication attempts. Please try again in 15 minutes.",
});

// Looser limit on task routes, keyed by user ID so users behind a shared IP don't throttle each other.
const taskLimiter = createRateLimiter({
  windowMs: 60 * 1000,
  maxRequests: 60,
  keyGenerator: (req) => `user:${req.user?.userId ?? req.ip}`,
  message: "Task request limit exceeded. Please wait a moment.",
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

app.post("/api/auth/register", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || typeof email !== "string" || !email.includes("@")) {
    return res.status(400).json({ error: "Valid email address is required" });
  }
  if (!password || typeof password !== "string" || password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const normalizedEmail = email.toLowerCase().trim();
    const passwordHash = await bcrypt.hash(password, 10);
    const result = insertUser.run(normalizedEmail, passwordHash, new Date().toISOString());
    const token = signToken(result.lastInsertRowid);

    return res.status(201).json({
      user: { id: result.lastInsertRowid, email: normalizedEmail },
      token,
    });
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Email already registered" });
    }
    return res.status(500).json({ error: "Registration failed" });
  }
});

// Same generic error for unknown email and wrong password, so attackers can't enumerate accounts.
app.post("/api/auth/login", authLimiter, async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const user = findUserByEmail.get(email.toLowerCase().trim());
  if (!user) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const matches = await bcrypt.compare(password, user.password_hash);
  if (!matches) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const token = signToken(user.id);
  res.status(200).json({ user: { id: user.id, email: user.email }, token });
});

// Order matters: requireAuth sets req.user, which taskLimiter uses as its key.
app.use("/api/tasks", requireAuth, taskLimiter);

app.get("/api/tasks", (req, res) => {
  const rows = selectUserTasks.all(req.user.userId);
  res.status(200).json(rows.map(mapTaskRow));
});

app.post("/api/tasks", (req, res) => {
  const { title, description, dueDate } = req.body ?? {};

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    return res.status(400).json({ error: "Title is required" });
  }

  const formattedDueDate =
    typeof dueDate === "string" && dueDate.trim() !== "" ? dueDate.trim() : null;

  // user_id always comes from the verified token, never from the request body.
  const info = insertTask.run(
    title.trim(),
    description ?? null,
    new Date().toISOString(),
    formattedDueDate,
    req.user.userId
  );
  const row = selectTaskByIdAndUser.get(info.lastInsertRowid, req.user.userId);
  res.status(201).json(mapTaskRow(row));
});

app.patch("/api/tasks/:id", (req, res) => {
  // Returns 404 (not 403) for other users' tasks, so their IDs aren't confirmed to exist.
  const existing = selectTaskByIdAndUser.get(req.params.id, req.user.userId);
  if (!existing) {
    return res.status(404).json({ error: "Not found" });
  }

  const { title, description, dueDate, completed } = req.body ?? {};
  if (title !== undefined && (typeof title !== "string" || title.trim() === "")) {
    return res.status(400).json({ error: "Title cannot be empty" });
  }

  // Partial update: fields not sent keep their current values; "" or null clears optional fields.
  const clean = (value) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;

  const nextTitle = title !== undefined ? title.trim() : existing.title;
  const nextDescription = description !== undefined ? clean(description) : existing.description;
  const nextDueDate = dueDate !== undefined ? clean(dueDate) : existing.due_date;
  const nextCompleted =
    typeof completed === "boolean" ? (completed ? 1 : 0) : existing.completed;

  updateTaskFull.run(
    nextTitle,
    nextDescription,
    nextDueDate,
    nextCompleted,
    req.params.id,
    req.user.userId
  );
  const updated = selectTaskByIdAndUser.get(req.params.id, req.user.userId);

  res.status(200).json(mapTaskRow(updated));
});

app.delete("/api/tasks/:id", (req, res) => {
  const existing = selectTaskByIdAndUser.get(req.params.id, req.user.userId);
  if (!existing) {
    return res.status(404).json({ error: "Not found" });
  }

  deleteTaskByIdAndUser.run(req.params.id, req.user.userId);
  res.status(204).end();
});

module.exports = app;