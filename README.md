# Multi-Tenant Task Manager

A full-stack task manager I built from scratch with **React + Vite** on the frontend and **Node.js + Express + SQLite** on the backend. It started as a learning project: I rebuilt a small task app from the ground up, then compared my version against a reference implementation and kept extending it. It grew into a multi-tenant app with JWT auth, row-level data isolation, and tiered rate limiting.

I wrote down what I learned along the way. The design decisions are below, and my longer study notes are in [`docs/learning-notes.md`](docs/learning-notes.md).

## Features

- Create, edit, complete, and delete tasks, with optional descriptions and due dates (overdue tasks get flagged)
- Register and log in with email and password (bcrypt-hashed), using stateless JWTs
- Every user only ever sees and touches their own tasks: every query is scoped by `user_id`
- Tiered rate limiting: strict per-IP limits on auth routes, looser per-user limits on task routes
- A non-destructive migration that turned the original single-user database into a multi-tenant one without losing any rows
- Integration tests with Jest and Supertest

## Tech stack

| Layer | Tools |
| --- | --- |
| Frontend | React, Vite |
| Backend | Node.js, Express |
| Database | SQLite via `better-sqlite3` |
| Auth | `jsonwebtoken`, `bcryptjs` |
| Testing | Jest, Supertest |

## Running it locally

**Backend**

```bash
cd my-app/backend
npm install
cp .env.example .env        # then set JWT_SECRET to a long random string
npm run dev
```

The API runs on `http://localhost:3001`. `npm run dev` uses `node --watch`, which restarts the server on save, the same way Vite hot-reloads the frontend, so there's no need for nodemon.

**Frontend**

```bash
cd my-app/client
npm install
npm run dev
```

The app runs on `http://localhost:8080` (set in `vite.config.js`).

**Tests**

```bash
cd my-app/backend
npm test
```

## Project structure

```
my-app/
  backend/
    app.js               Express app: routes, prepared statements, limiter setup (exported, no listen)
    server.js            Starts the app on a port
    db.js                Schema, migration, and backfill
    middleware/
      auth.js            signToken + requireAuth (JWT verification)
      rateLimiter.js     Configurable in-memory rate limiter factory
    tests/
      api.test.js        Integration tests (Jest + Supertest)
  client/
    src/
      App.jsx            UI: auth screen, task list, create/edit forms
      api.js             API client layer: every fetch call lives here
      main.jsx           React entry point
    vite.config.js
docs/
  learning-notes.md      My longer notes on everything I learned building this
```

`app.js` and `server.js` are split on purpose: `app.js` builds and exports the Express app without opening a port, so the tests can import it directly, and `server.js` is the only file that calls `listen()`.

## API

| Method | Route | Auth | Rate limit | Success | Errors |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/register` | No | 5 / 15 min per IP | 201 `{ user, token }` | 400, 409, 429 |
| POST | `/api/auth/login` | No | 5 / 15 min per IP | 200 `{ user, token }` | 401, 429 |
| GET | `/api/tasks` | Bearer token | 60 / min per user | 200 task array, newest first | 401, 429 |
| POST | `/api/tasks` | Bearer token | 60 / min per user | 201 created task | 400, 401, 429 |
| PATCH | `/api/tasks/:id` | Bearer token | 60 / min per user | 200 updated task | 400, 401, 404, 429 |
| DELETE | `/api/tasks/:id` | Bearer token | 60 / min per user | 204 no body | 401, 404, 429 |

`PATCH` is a partial update. Any field you leave out keeps its current value, and sending `""` or `null` clears an optional field like the description or due date.

## How a request flows through the app

```
Browser (App.jsx)
   │  api.js attaches  Authorization: Bearer <token>
   ▼
Express
   │
   ├─ Public:    POST /api/auth/*  ──►  authLimiter (by IP)  ──►  bcrypt + SQLite
   │
   └─ Protected: /api/tasks/*
                    │
                    ▼
               requireAuth   verifies the JWT, sets req.user = { userId }
                    │
                    ▼
               taskLimiter   counts hits for user:<userId>
                    │
                    ▼
               route handler  every query has  WHERE ... AND user_id = ?
                    │
                    ▼
               mapTaskRow()  DB row ──► clean JSON for React
```

## Design decisions

### Authentication vs. authorization

These are two separate things. **Authentication** is "who are you?" The user logs in with email and password, I verify it with `bcrypt.compare`, and the server signs a JWT containing their `userId`. The client sends that token in the `Authorization: Bearer` header on every request, and `requireAuth` verifies the signature and attaches `req.user`.

**Authorization** is "are you allowed to touch this specific row?", and that's the part people get wrong. Putting `requireAuth` on a route isn't enough. If my update query were `UPDATE tasks SET ... WHERE id = ?`, any logged-in user could edit someone else's task just by guessing its ID. That's an IDOR (Insecure Direct Object Reference) vulnerability. So authorization isn't a feature I bolted onto the routes; it's a filter on every single query:

```sql
SELECT * FROM tasks WHERE id = ? AND user_id = ?
UPDATE tasks SET ... WHERE id = ? AND user_id = ?
DELETE FROM tasks WHERE id = ? AND user_id = ?
```

A few details that go with it:

- The `user_id` always comes from the verified token (`req.user.userId`), **never** from `req.body`. The client can't forge it, because tampering with the JWT breaks its signature.
- If you ask for another user's task you get **404**, not 403, so you can't even confirm that the task ID exists.
- Login returns the same generic "Invalid email or password" whether the email doesn't exist or the password is wrong, so attackers can't use it to find out which emails have accounts.

### Rate limiting

Authentication tells you who someone is, but it doesn't protect your server from being hammered. I added two tiers of limits:

- **Auth routes:** 5 requests per 15 minutes, keyed by IP. This stops brute-force password guessing, and the request is rejected before bcrypt even runs, so attackers can't burn CPU either.
- **Task routes:** 60 requests per minute, keyed by user ID.

**The non-obvious thing: the order of the middleware matters.** On protected routes, `requireAuth` runs *before* the limiter, so the limiter can key on the verified user ID instead of the IP. If you limit by IP alone, everyone behind a shared IP (an office, a university, a mobile network) shares one quota, and one person can lock everyone else out.

Every response carries `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset` headers. When you go over, you get a `429 Too Many Requests` with a `Retry-After` header, and the request never reaches the route handler or the database.

**Which algorithm it uses:** a **fixed-window counter**. Each key stores `{ count, resetTime }`, and the count resets when the window expires. I originally called it a sliding window, but that's not what it is. A fixed window has a known weakness: a client can send a full quota at the very end of one window and another full quota at the start of the next, so up to 2x the limit gets through in a couple of seconds. A sliding-window counter fixes that by weighting the previous window's count.

**Why it's in memory, and where that breaks:** the limiter stores its counters in a `Map`, with a cleanup interval that evicts expired keys every minute. Without that cleanup, a client that sends one request and disappears would sit in memory forever, and the Map would keep growing until Node runs out of heap. The in-memory approach works on one server, but it has two real limits:

1. **Restarts wipe it.** Every deploy or crash resets everyone's quota.
2. **It doesn't work across multiple servers.** Behind a load balancer with 3 containers, each one has its own Map, so a client can get 3x the limit just by having requests spread across them.

The fix for both is moving the counters into **Redis**: one shared store that every server talks to, that survives app restarts, has native key expiry (no cleanup loop needed), and increments atomically (`INCR`), so two requests hitting two servers at the same millisecond are both counted.

### Migrating from single-user to multi-tenant

The app started with no users, so the existing tasks had no owner. Adding a `user_id NOT NULL` column would have failed immediately on the existing rows. So `db.js` does a non-destructive migration:

1. Checks the table with `PRAGMA table_info(tasks)`, and only adds `user_id` if it's missing (as a nullable column first)
2. Finds any tasks with no owner
3. Creates a seed user (with a random password, since it only exists to hold old tasks) and backfills those tasks to it

No rows are lost or orphaned, and running it again does nothing because there's nothing left to migrate.

### A data mapper between the database and the API

I don't send raw SQLite rows to the client. Everything goes through `mapTaskRow()`, which solves four problems:

1. **SQLite has no boolean type.** It stores `completed` as `0`/`1`. The mapper turns it into a real `true`/`false`, so the frontend can write `if (task.completed)` instead of remembering `=== 1` everywhere.
2. **Naming conventions.** The database uses `snake_case` (`created_at`), and JavaScript uses `camelCase` (`createdAt`). The mapper translates, so renaming a column doesn't break every component.
3. **`null` vs `""`.** An empty description comes back as `""` instead of `null`. That keeps React inputs controlled from the start, and stops `.trim()` from crashing on `null`.
4. **It's a whitelist.** Only fields I explicitly list are sent. If I ever add an internal column, `SELECT *` won't accidentally leak it to the browser.

### Validation: 400 vs 500

At first I relied on frontend validation plus a `try/catch` that returned 500 for anything that went wrong. That was wrong for two reasons:

- **Never trust the client.** My React form is only one possible client. Anyone can hit `POST /api/tasks` directly with curl or Postman, so the backend has to validate everything itself. Frontend validation is for user experience; backend validation is for keeping the data correct.
- **A bad request isn't a server error.** A missing title is the client's mistake (400 Bad Request), not a server crash (500). Returning 500 for bad input creates false alarms in monitoring and confuses anyone using the API.

So every route now validates its input up front and returns a specific 400. It also uses `req.body ?? {}`, so an empty or unparseable body doesn't crash the route when it tries to destructure it.

### Prepared statements at startup

All static queries are prepared once, at the top of `app.js`, instead of inside each route. Three reasons:

1. **No repeated compiling.** `db.prepare()` parses the SQL, plans the query, and compiles it to bytecode. Doing that once at startup instead of on every request avoids repeating that work. (`better-sqlite3` does cache statements internally, so this matters less than it sounds, but the other two reasons still hold.)
2. **Fail fast.** A typo like `SELECT * FORM tasks` crashes the server the moment it boots, instead of hiding in a rarely used route until a real user hits it.
3. **It's a catalog.** The top of the file lists every database operation the app supports, and the routes only deal with HTTP.

The tradeoff: this only works for static queries. A query whose `WHERE` clause changes based on URL filters has to be built and prepared inside the route.

### Updating local state instead of refetching

My first version refetched the whole task list after every create, toggle, or delete. That's two network requests per action. Now the frontend updates its own state using the single task the server sends back:

```js
setTasks([newTask, ...tasks]);                                // create: prepend
setTasks(tasks.map((t) => (t.id === task.id ? updated : t))); // update: swap one
setTasks(tasks.filter((t) => t.id !== task.id));              // delete: drop one
```

It halves the network traffic and keeps the list from flashing or losing its scroll position. New tasks are prepended (not appended) so the screen matches the backend's `ORDER BY created_at DESC`; otherwise a new task would show at the bottom and then jump to the top on refresh.

You also can't just do `tasks[index] = updated; setTasks(tasks)`. React checks whether state changed by comparing references, so mutating the same array in place means React thinks nothing changed and skips the re-render. `.map()` and `.filter()` both return a new array.

### Cancelling stale requests in `useEffect`

The effect that loads tasks uses a `cancelled` flag in its cleanup function. If the component unmounts (or the token changes) while a request is still in flight, the response is ignored instead of being written into state that no longer exists. This also matters in React Strict Mode, which mounts, unmounts, and remounts components in development, so without the flag two overlapping requests could race to update the list.

### Keeping network calls out of the UI

All `fetch` calls live in `api.js`, not in the components. The components only call things like `createTask(title, description)`; they don't know about URLs, headers, or JSON. That means:

- The API base URL lives in one place, so changing `/api/tasks` to `/api/v1/tasks` is a one-line change
- Headers like `Content-Type` and `Authorization` are set in one place, so a missing header can't silently break one component
- Each function checks for the exact status it expects (201 for create, 204 for delete) and throws a real error otherwise, so the UI can use plain `try/catch`
- The client handles a `429` by showing the rate-limit message without logging the user out

## Things I got wrong along the way

I'm keeping these because they taught me the most.

- **One `isChecked` state for every checkbox.** I used a single `useState` for checkboxes, so checking one task checked all of them, and after a refresh the boxes didn't match the database at all. The fix was tying each checkbox to its own data, `checked={task.completed}`, and sending that task's flipped value to the API. The rule I took from it: if the data already exists in your API response, derive the UI from it. Separate state is only for purely UI things like an open modal or text being typed.
- **Installing vanilla Vite instead of React + Vite.** I only noticed when I couldn't find `vite.config.js` and had a `counter.js` instead of React files. The fix was `npm create vite@latest client -- --template react`.
- **Calling my rate limiter a sliding window.** It's a fixed window (see above), and knowing the difference matters.
- **Returning 500 for bad input.** See "Validation: 400 vs 500" above.

## Testing

Before this, my "testing" was clicking through the UI and reading `console.log` output. That's debugging, and it works at a small size, but it isn't automated testing: nothing would tell me that adding task editing broke the checkbox, except me noticing.

The tests are **integration tests** against the HTTP endpoints, using Supertest. Supertest sends requests straight into the Express app (imported from `app.js`) without starting a real server, so tests run in milliseconds. I test at the HTTP layer because the API is the contract between the frontend and backend, and one test per endpoint covers the routing, validation, SQL, mapper, and response all at once. The suite covers:

- **Auth:** registering returns 201 with a signed token; logging in works with the right password and returns a 401 with a generic error for the wrong one
- **Protected routes:** a missing token and a tampered token both get 401
- **IDOR:** User 2 tries to delete User 1's task, gets a 404, and the task is still there for User 1 afterwards
- **Rate limiting:** after the auth quota is used up, the next login gets a 429 with `Retry-After` and `RateLimit-Remaining: 0`

The IDOR test is the one I care about most:

```js
it("(DELETE) /api/tasks/:id should prevent IDOR (User 2 cannot delete User 1's task)", async () => {
  const attackRes = await request(app)
    .delete(`/api/tasks/${user1TaskId}`)
    .set("Authorization", `Bearer ${user2Token}`);

  // The query is scoped by WHERE id = ? AND user_id = ?, so nothing matches -> 404
  expect(attackRes.status).toBe(404);

  // And the task is still there for its real owner
  const checkRes = await request(app)
    .get("/api/tasks")
    .set("Authorization", `Bearer ${user1Token}`);
  expect(checkRes.body.some((task) => task.id === user1TaskId)).toBe(true);
});
```

Next tests to add: 400s for missing or blank titles, `PATCH` partial updates, and the per-user task limiter.

What these tests *can't* catch: anything in the browser (rendering, state updates), real concurrency, or performance. A single end-to-end browser test (create a task, refresh, confirm it's still there) would be the next layer.

## What I'd change next

- **Redis-backed rate limiting** so limits hold across multiple servers and survive restarts
- **A sliding-window counter** to close the 2x boundary burst
- **Real migration files** (`001_create_tasks.sql`, `002_add_due_date.sql`, ...) with a table tracking which ones have run. `CREATE TABLE IF NOT EXISTS` can't add a column to a table that already exists, which is why my user migration needed a manual `PRAGMA` check.
- **Postgres instead of SQLite** once there's more than one backend server. SQLite is a single file on one machine, so a second server can't share it.
- **Cursor-based pagination** instead of `OFFSET`, so pages don't skip or repeat rows when tasks are added, and deep pages stay fast
- **Tags** (a many-to-many design with a junction table) and **priority** (a column with a `CHECK` constraint, sorted with a `CASE` expression). I've designed both; the notes are in [`docs/learning-notes.md`](docs/learning-notes.md)
- **A separate test database.** Right now the tests run against the same `tasks.sqlite` file as development, so every run leaves test users behind. Reading the path from a `DB_PATH` environment variable and setting it to `:memory:` in tests would give every run a clean database.
- **A Dockerfile and a GitHub Actions workflow** that runs the tests on every push
