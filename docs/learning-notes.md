# Learning Notes

These are the notes I wrote while building this project. The [README](../README.md) covers the design decisions that made it into the code; this file goes deeper into the concepts behind them, plus designs for features I've planned but haven't built yet.

These are my own notes from building the project. I used Claude to organize and edit them into this format, the learning and the code are mine.

## Contents

1. [The stack: Node, npm, Express, Vite, React](#1-the-stack-node-npm-express-vite-react)
2. [SPA vs. SSR](#2-spa-vs-ssr)
3. [CORS and the Vite proxy](#3-cors-and-the-vite-proxy)
4. [SQLite vs. MySQL, and why data persists](#4-sqlite-vs-mysql-and-why-data-persists)
5. [Migrations](#5-migrations)
6. [ORMs](#6-orms)
7. [React concepts I had to really understand](#7-react-concepts-i-had-to-really-understand)
8. [Query parameters, filtering, and sorting](#8-query-parameters-filtering-and-sorting)
9. [Pagination: OFFSET vs. cursors](#9-pagination-offset-vs-cursors)
10. [Indexes](#10-indexes)
11. [Auth: sessions vs. JWTs, and the full lifecycle](#11-auth-sessions-vs-jwts-and-the-full-lifecycle)
12. [Rate limiting: algorithms and the full lifecycle](#12-rate-limiting-algorithms-and-the-full-lifecycle)
13. [Planned feature: tags (many-to-many)](#13-planned-feature-tags-many-to-many)
14. [Planned feature: priority](#14-planned-feature-priority)
15. [Testing](#15-testing)
16. [Linting: ESLint vs. Oxlint](#16-linting-eslint-vs-oxlint)
17. [Deploying it on AWS](#17-deploying-it-on-aws)

---

## 1. The stack: Node, npm, Express, Vite, React

- **Node.js** is the runtime: the engine that lets JavaScript run outside the browser, read files, and handle network connections.
- **npm** comes bundled with Node. It downloads packages into `node_modules` so Node can run them. Basically, Node is the iPhone and npm is the App Store.
- **Express** is a minimal web framework on top of Node. It's what I use to define the REST API routes. Node + Express together are the backend.
- **React** is what actually runs in the browser. It gives you components, JSX, and state (`useState`), and it updates the DOM when data changes.
- **Vite** is a dev tool and dev server that runs on my machine. Browsers don't understand JSX, so Vite translates it into standard JavaScript (using esbuild) and serves it.

**The DOM** (Document Object Model) is the browser's live, in-memory tree of objects representing the page. The HTML file is the blueprint; the DOM is the house built from it, and JavaScript can modify it.

**Why Vite is fast:** older dev servers bundled the entire app (every file) before the server could start. Vite skips that during development. It serves a nearly empty HTML file, and when the browser asks for `main.jsx`, then `App.jsx`, Vite transforms only the files actually requested. So the server starts almost instantly no matter how big the app gets. **Hot Module Replacement (HMR)** swaps just the component you edited in the browser, without reloading the page or wiping state.

**Why one language for the whole stack helps:** the frontend and backend are both JavaScript, so there's no context switching, and code can be shared between them. Express is also minimal and doesn't force a structure on you, which matches how Vite + React works.

**How the pieces talk:**

1. The browser requests the page
2. Vite serves the frontend; React runs in the browser
3. React calls `fetch("/api/...")`
4. Express handles the request, talks to the database, and sends JSON back to React

## 2. SPA vs. SSR

A **single-page application** doesn't mean the site only has one screen. It means the browser loads one HTML file and one JavaScript bundle on the first visit, and after that a client-side router swaps components and updates the URL without ever reloading the page. In a traditional multi-page app, every click fetches a whole new HTML page from the server.

| | SPA (Vite + React) | SSR (Next.js / Remix) |
| --- | --- | --- |
| Where is the HTML built? | In the browser, by JavaScript | On the server, before it's sent |
| First page load | Slower: the browser downloads JS first | Fast: the browser gets ready-to-view HTML |
| Later clicks | Instant, no page reloads | Fast, may involve a server round trip |
| SEO and link previews | Weak out of the box | Strong |
| Hosting cost | Very cheap: static files on a CDN | Higher: needs a running Node server |

SSR is better for SEO because crawlers get a fully built HTML document instead of an empty `<div id="root"></div>`. For an app behind a login, like this one, SEO doesn't matter, so an SPA is the right fit.

Vite also does **code splitting**: it only loads the code for the page the user is on, and fetches the rest when they navigate there.

## 3. CORS and the Vite proxy

**CORS** (Cross-Origin Resource Sharing) is a browser security rule: JavaScript on one origin can't read responses from another origin unless that origin explicitly allows it. It's purely a browser mechanism; curl, Postman, and server-to-server calls never trigger it.

An **origin** is protocol + domain + port. So `localhost:5173` (Vite) and `localhost:3001` (Express) are different origins, even on the same laptop.

There are two ways to deal with that during development:

**1. The `cors` middleware** (what this repo uses). Express adds response headers saying "requests from these origins are allowed." The backend keeps an explicit allowlist of the dev origins. This is the right choice when the frontend and backend will live on different domains in production (say, frontend on Vercel and backend on Render), because you'll need CORS configured there anyway.

**2. A Vite dev proxy.** The browser calls `fetch("/api/tasks")` on its own origin (`localhost:5173`), so CORS never triggers. The Vite dev server is a real Node HTTP server; it catches `/api/*` requests and forwards them server-to-server to Express, then pipes the response back. Server-to-server calls have no browser sandbox, so CORS doesn't apply. This is a good fit when everything will be deployed together on one domain (for example, Express serving the built frontend), because your `fetch` calls stay relative (`/api/...`) and match production.

## 4. SQLite vs. MySQL, and why data persists

**The backend is stateless.** When the Express server stops, everything in its memory (variables, arrays, the rate limiter's Map) is gone. The database is different: it writes to disk, so data survives restarts. SQLite and MySQL just store it differently:

- **SQLite (`better-sqlite3`)** keeps everything in a single file in the project folder.
- **MySQL** runs as a separate background service that stores data in its own system directories. When Express restarts, it reconnects to that service and asks for the data.

**Why `better-sqlite3` is fast for a project like this:** SQLite isn't a server. It's a C library loaded directly into the Node process. A query is a direct function call in memory: no network socket, no separate process, no serializing data back and forth. MySQL, even on the same laptop, is a separate program, so every query is sent over a socket and the result is sent back. `better-sqlite3` is also synchronous, which skips the overhead of creating a Promise for every query.

**The catch:** a SQLite database is a file on one machine. Once traffic needs more than one backend server, server B can't see server A's file. That's when you move to a database server like MySQL or Postgres that every app server can connect to.

**Moving from SQLite to MySQL**, roughly:

1. Export the data: `sqlite3 tasks.sqlite .dump > backup.sql`
2. Convert the SQL dialect. The dump won't run on MySQL as-is because the two have syntax differences, so it needs cleanup by hand or with a conversion tool.
3. Create an empty MySQL database and import it: `mysql -u user -p dbname < converted.sql`

## 5. Migrations

A **migration** is one recorded, numbered change to the database schema: "create the tasks table," "add a `due_date` column," "create the users table." Each one is a file:

```
migrations/
  001_create_tasks.sql
  002_add_due_date.sql
  003_create_users.sql
```

The database also gets a small table listing which migrations have already run. When the migration tool runs, it compares the two: if 001 and 002 have run, it runs only 003 and records it. Running it again does nothing.

**Why my current approach eventually stops working:** `db.js` runs `CREATE TABLE IF NOT EXISTS` on every boot. That can only express "make sure this table exists." It can't express "add a column to a table that already exists," because `IF NOT EXISTS` sees the table and skips it. That's exactly why my multi-tenant migration needed a manual `PRAGMA table_info` check. Migrations give the database a history, so every environment (my machine, a teammate's, staging, production) ends up with the same schema without anyone remembering what they ran by hand.

**Why it matters even more on Postgres:**

- Several app containers can boot at the same time and all try to change the schema. Migration tools take a **lock** so only one instance applies changes while the others wait.
- Changes to a live table with real data need care. Adding a `NOT NULL` column needs a default or a backfill, exactly like my `user_id` migration. A migration file makes that a reviewed, repeatable step instead of someone typing SQL into a production console.

Without migrations you get "works on my machine" (a teammate's database is missing the column you added by hand), risky manual changes in production, and no record of who changed the schema or why.

## 6. ORMs

An **ORM** (Object-Relational Mapper, like Prisma or Sequelize) lets you query the database with JavaScript methods instead of writing SQL strings:

```js
// Raw SQL (what this project does)
const tasks = db.prepare("SELECT * FROM tasks WHERE completed = ?").all(1);

// ORM (Prisma)
const tasks = await prisma.task.findMany({ where: { completed: true } });
```

**What you gain:**

- **Easier database switches.** Moving from SQLite to MySQL is mostly a config change instead of rewriting SQL dialects.
- **Autocomplete and type safety.** Your editor knows your schema, so passing a string where a number is expected gets caught before the app runs.
- **Safe parameters by default.** SQL injection happens when user input is pasted straight into a query string. ORMs always parameterize. (Raw SQL is just as safe when you use placeholders like `?`, which this project does everywhere; the danger is building queries with string concatenation.)

**What it costs:**

- **Overhead.** The ORM translates objects to SQL and rows back to objects on every query, and for complex queries the SQL it generates can be much slower than hand-written SQL that uses the right indexes.
- **The N+1 problem.** Fetch 100 tasks, then loop and fetch each task's category, and a careless ORM fires 101 queries instead of one `JOIN`. Under load, that can take a server down.
- **Less control** over exactly what SQL runs.
- **Lock-in.** Your code depends on that library's syntax, its upgrades, and its bugs.

## 7. React concepts I had to really understand

### Controlled components

```jsx
<select value={filter} onChange={(e) => setFilter(e.target.value)}>
```

`onChange` sends the user's choice from the DOM into React state, and `value={filter}` forces the DOM to show whatever's in state. Because each one feeds the other, they stay locked together and React is always in control of what the screen shows.

This is also why the data mapper returns `""` instead of `null` for an empty description: `value={null}` tells React the input is *uncontrolled*, and the moment the user types, it becomes controlled, which triggers a warning.

### Derive state from data

My checkbox bug (one `isChecked` state for every task) taught me this. If the data already exists in the API response, derive the UI from it (`checked={task.completed}`) instead of copying it into a separate state variable that can drift out of sync with the database. Separate state is for UI-only things: an open modal, a dropdown, text being typed.

### `useEffect` and the dependency array

`useEffect` runs *after* React has rendered and painted the screen, as a side effect. The dependency array decides when it runs again:

- No array: after every render
- `[]`: once, when the component first mounts
- `[token]`: on mount, and again whenever `token` changes

In this app the load effect depends on `[token]`, so tasks are fetched as soon as the user logs in. It acts like a tripwire: whatever changes the token, the effect re-syncs with the server, and it always sees the new value.

### Cleanup and the `cancelled` flag

Whatever function you `return` from `useEffect` is the **cleanup function**. React runs it when the component unmounts or before the effect runs again.

```js
useEffect(() => {
  let cancelled = false;
  async function load() {
    const result = await listTasks();
    if (!cancelled) setTasks(result);
  }
  load();
  return () => {
    cancelled = true;
  };
}, [token]);
```

Two ways it can play out:

- **The user stays on the page:** the response arrives, `cancelled` is still `false`, and the tasks are set.
- **The user leaves first:** the component unmounts, React runs the cleanup (`cancelled = true`), and when the slow response finally arrives, the `if` skips the state update. No update on a dead component, and no stale data overwriting newer data.

This matters in development too, because React Strict Mode deliberately mounts, unmounts, and remounts components. Without the flag, two overlapping requests race to set the list.

### Immutability

React decides whether to re-render by checking if the state is a *new* object (`oldState === newState`). Mutating an array in place (`tasks[i] = updated`) keeps the same reference, so React thinks nothing changed. `.map()`, `.filter()`, and spread (`[newTask, ...tasks]`) all return new arrays.

When the next state depends on the previous one, use the function form, which always gets the freshest value even if another update is pending:

```js
setCursorHistory((prev) => [...prev, cursor]);
```

### Promises

JavaScript has one thread. If it sat and waited two seconds for a network response, the whole page would freeze. A **Promise** is an object representing a result that arrives later. It's always in one of three states: **pending** (still working), **fulfilled** (done, with a value), or **rejected** (failed, with an error). `await` pauses only the current async function, not the whole page.

## 8. Query parameters, filtering, and sorting

Query parameters come after the `?` in a URL, and Express parses them into `req.query`:

```
GET /api/tasks?completed=true&search=groceries&page=2
→ req.query = { completed: "true", search: "groceries", page: "2" }
```

- They're **always strings** (`"true"`, not `true`; `"2"`, not `2`), so they need converting and validating.
- A missing parameter is `undefined`.
- A repeated key becomes an array: `?tag=home&tag=work` → `{ tag: ["home", "work"] }`.
- You can't route on them: `app.get("/api/tasks?completed=true")` doesn't work, because Express only matches the path. Every variation goes to `app.get("/api/tasks")` and gets handled inside it.

**Building a dynamic `WHERE` clause:** push a condition and its parameter for each filter that's present, then join them:

```js
const conditions = ["user_id = ?"];
const params = [req.user.userId];

if (req.query.completed !== undefined) {
  conditions.push("completed = ?");
  params.push(req.query.completed === "true" ? 1 : 0);
}
if (req.query.search) {
  conditions.push("title LIKE ?");
  params.push(`%${req.query.search}%`);
}

const sql = "SELECT * FROM tasks WHERE " + conditions.join(" AND ");
const rows = db.prepare(sql).all(...params);
```

`.join(" AND ")` only puts `AND` *between* items, so one condition doesn't get a trailing `AND`. The two arrays stay in sync because each `if` pushes to both. Because this query changes per request, it has to be prepared inside the route rather than at startup.

**`LIKE` patterns:** `%` matches any number of characters and `_` matches exactly one. `'A%'` starts with A, `'%a'` ends with a, `'%apple%'` contains "apple" anywhere, and `'_r%'` has "r" as its second letter.

**Sorting: you can't use `?` for column names.** Placeholders only bind *values*, not SQL keywords or column names, so `ORDER BY ? ?` doesn't work. Instead, check the requested column and direction against a whitelist and put the approved values into the SQL yourself:

```js
const SORTABLE = { createdAt: "created_at", title: "title", dueDate: "due_date" };
const column = SORTABLE[req.query.sort] ?? "created_at";
const direction = req.query.order === "asc" ? "ASC" : "DESC";
const sql = `SELECT * FROM tasks WHERE user_id = ? ORDER BY ${column} ${direction}, id ${direction}`;
```

This is safe because only strings from my own whitelist ever reach the query. The trailing `id` gives every row a unique position, which matters for pagination.

## 9. Pagination: OFFSET vs. cursors

### OFFSET

`LIMIT` is "give me at most N rows," and `OFFSET` is "skip the first M rows first." Pages count from zero, so:

```
offset = (page - 1) * limit
```

With 5 per page: page 1 skips 0, page 2 skips 5, page 3 skips 10. `LIMIT` and `OFFSET` always come last, after `ORDER BY`. And because `page` arrives as a string, it needs `parseInt` plus a check for `NaN` and negative numbers.

OFFSET has two real problems in production:

1. **Drift.** Data changes while users page through it. If a new task is inserted at the top while you're on page 1, everything shifts down one, and page 2 shows the last task from page 1 again. If a task is deleted, one slides up and you skip it without ever seeing it.
2. **It gets slower.** `OFFSET 100000` can't jump to row 100,000. The database reads and throws away 100,000 rows to return the 5 you asked for.

### Cursor (keyset) pagination

Instead of "skip M items," you say "give me the items after bookmark X":

```sql
SELECT * FROM tasks WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT ?
```

With an index, the database jumps straight to the bookmark and reads only the rows it needs, and new inserts don't shift what you see.

- Newest first (descending) uses `id < ?`; ascending uses `id > ?`. The strict inequality keeps the cursor row itself off the next page.
- A cursor has to be **unique, stable, and in a fixed order**. A primary key `id` is all three. `created_at` and `title` can repeat, so sorting by them alone can drop or repeat rows.

**The `LIMIT + 1` trick:** how do you know if there's a next page without running a separate `COUNT(*)`? Ask for one extra row:

- Asked for 5, got 5 or fewer back: you've hit the end, so `hasNextPage = false` and `nextCursor = null`.
- Asked for 5, got 6 back: there's more. Drop the 6th row (never send it to the client), set `hasNextPage = true`, and use the **5th** row's `id` as the next cursor.

**Sorting by something other than `id`:** a query can only have one `ORDER BY`, so you can't sort by title and then separately by id for the cursor. You combine them into one ordering (`ORDER BY title, id`) and use a **composite cursor** of both values. That needs the sort column to be `NOT NULL`, both columns sorted in the same direction (or explicit `OR`/`AND` conditions), and a matching compound index.

**Going back a page:** cursors only point forward, so the frontend keeps a stack of the cursors it's used:

```js
// Next: push the current cursor, move forward
setCursorHistory((prev) => [...prev, cursor]);
setCursor(nextCursor);

// Previous: pop the last cursor and go back to it
const previousCursor = cursorHistory[cursorHistory.length - 1];
setCursorHistory((prev) => prev.slice(0, -1));
setCursor(previousCursor);
```

`.slice(0, -1)` copies everything except the last item, so `[null, 100, 95]` becomes `[null, 100]`.

## 10. Indexes

Without an index, `SELECT * FROM tasks WHERE completed = 1` or `ORDER BY created_at DESC` is a **full table scan**: SQLite reads every row to see if it matches. With 20 rows that's instant; with 2 million it falls apart.

An **index** is a separate sorted structure (usually a B-tree, a self-balancing tree designed for fast searching) that stores a column's values with pointers to the matching rows. It's the index at the back of a book: instead of reading all 600 pages for "Express," you look it up and jump to the page. It turns an O(N) scan into an O(log N) lookup.

The tradeoff is that every insert and update also has to update the index, so you add them for the columns you actually filter and sort on. For this app that's mainly `tasks(user_id)`, since every query filters on it.

## 11. Auth: sessions vs. JWTs, and the full lifecycle

### Sessions vs. JWTs

| | Server-side sessions | JWTs (what this app uses) |
| --- | --- | --- |
| How it's carried | A session ID in an HttpOnly cookie | A signed token, sent as `Authorization: Bearer <token>` |
| How the server checks it | Looks up the session ID in a database or cache like Redis | Verifies the signature with the secret key; no lookup needed |
| Pros | Safe from XSS (JavaScript can't read HttpOnly cookies); can be revoked instantly | Stateless; easy to test with curl or Postman |
| Cons | Needs server-side storage and a lookup on every request | Hard to revoke before it expires (needs a denylist); readable by XSS if stored in `localStorage` |

**XSS** (cross-site scripting) is when an attacker gets their own JavaScript to run on your site, usually by submitting text (a comment, a task title) that the app puts into the page without escaping it. The browser trusts it as part of your site, so it can read anything your site can, including a token in `localStorage`. React escapes text by default, which blocks the most common version of this.

### Phase 1: Login and registration

```
App.jsx: user submits email + password
   │
   ▼
api.js: POST /api/auth/login  { email, password }
   │
   ▼
authLimiter: has this IP made more than 5 attempts?
   ├── yes ──► 429 (bcrypt never runs, so no CPU burned)
   └── no
        │
        ▼
   REGISTER                          LOGIN
   bcrypt.hash(password, 10)         findUserByEmail.get(email)
   insertUser.run(...)                  ├── not found ──► 401 "Invalid email or password"
        │                               ▼
        │                            bcrypt.compare(password, hash)
        │                               ├── no match ──► 401 "Invalid email or password"
        └───────────────┬───────────────┘
                        ▼
        signToken(userId) → jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" })
                        │
                        ▼
        201 / 200  { user: { id, email }, token }
                        │
                        ▼
        api.js saves the token (in memory + localStorage)
        App.jsx switches from the auth screen to the task list
```

### Phase 2: Authenticated requests

```
App.jsx calls listTasks(), createTask(), ...
   │
   ▼
api.js adds headers:
   Content-Type: application/json
   Authorization: Bearer eyJhbGciOi...      (the token goes in the header, never the body)
   │
   ▼
requireAuth
   ├── missing or not "Bearer ..." ──► 401
   ├── bad signature or expired    ──► 401
   └── valid ──► req.user = { userId, iat, exp }
   │
   ▼
taskLimiter: over 60 requests/min for user:<userId>? ──► 429
   │
   ▼
Route handler, always scoped:
   GET     SELECT * FROM tasks WHERE user_id = ?
   POST    INSERT ... user_id = req.user.userId    (never from req.body)
   PATCH   UPDATE ... WHERE id = ? AND user_id = ?
   DELETE  DELETE ... WHERE id = ? AND user_id = ?  (someone else's task ──► 404)
   │
   ▼
mapTaskRow(row) ──► JSON
   │
   ▼
api.js:
   ├── 401: token expired mid-session ──► clear it, back to login
   └── 2xx: return the data ──► App.jsx updates state
```

### Phase 3: Logout

The frontend clears the token from memory and `localStorage`, sets the token state back to `null` (which swaps the screen back to the login form), and empties the task list so no data stays in memory.

### The short version

"Auth is two separate things. Authentication is who you are: a users table, passwords hashed with bcrypt, and a signed JWT on login that the client sends as a Bearer token. Middleware verifies it and attaches the user to the request.

Authorization is what you're allowed to touch, and that's the part people get wrong. It's not a check on the route; it has to be in every query. Every select, update, and delete gets `AND user_id = ?`. Otherwise a logged-in user can edit someone else's task just by guessing the ID.

And the existing tasks have no owner, so you need a migration: add the column as nullable, backfill it to a default user, then tighten it."

## 12. Rate limiting: algorithms and the full lifecycle

### The algorithms

- **Fixed-window counter** (what this app uses): count hits within a fixed window, then reset. Very cheap on memory, but it has the **boundary burst** problem: a client can send a full quota at 12:00:59 and another full quota at 12:01:01, so 2x the limit gets through in two seconds.
- **Sliding-window log:** store a timestamp for every request and count the ones newer than `now - windowMs`. Exact, but memory grows with traffic because it keeps one timestamp per request.
- **Sliding-window counter** (the common real-world choice): keep only the current and previous window's counts, and weight the previous one by how much of it still overlaps: `count = current + previous × (1 - elapsed fraction of the current window)`. It blocks boundary bursts while storing only a couple of numbers per client.
- **Token bucket:** each client has a bucket that refills at a steady rate, and each request takes a token. It allows short bursts up to the bucket size while keeping the average rate fixed.

### The headers

While a client is under the limit, every response includes `RateLimit-Limit`, `RateLimit-Remaining`, and `RateLimit-Reset`. Once they're over, the server stops right there and returns `429 Too Many Requests` with a `Retry-After: <seconds>` header telling the client when to try again.

### The full lifecycle

```
Request arrives
   │
   ├─ Public route  ──► authLimiter, key = "ip:<address>"
   └─ Protected     ──► requireAuth ──► taskLimiter, key = "user:<userId>"
   │
   ▼
record = store.get(key)
   ├── no record, or window expired ──► { count: 1, resetTime: now + windowMs }
   └── active window ──► count += 1
   │
   ▼
Set RateLimit-Limit / -Remaining / -Reset headers
   │
   ▼
count > maxRequests ?
   ├── yes ──► Retry-After header, return 429 (route and DB never touched)
   └── no  ──► next() ──► route handler
   │
   ▼
api.js on the frontend:
   ├── 429 ──► read Retry-After, show "try again in Ns"
   │           (don't clear the token, don't reload: the user is still logged in)
   └── 2xx ──► return the data
```

Separately, a timer in the Node event loop fires every 60 seconds, walks the Map, and deletes every key whose window has expired.

### What resets an in-memory limiter (and what doesn't)

- **A browser refresh doesn't.** The counter lives on the server.
- **A server restart does.** The Map lives in the Node process's memory, so a crash, a deploy, or a file change under `--watch` wipes every client's count and gives everyone a full quota back.
- **Multiple servers split it.** Each container has its own Map, so behind a load balancer with 3 containers, a client can get 3x the limit.

Redis fixes all three, and adds atomic increments so two simultaneous requests on two servers are both counted. See the README for the full reasoning.

## 13. Planned feature: tags (many-to-many)

Every feature so far mapped cleanly onto one row: one task has one title, one description, one due date. Tags break that. One task can have many tags, and one tag can be on many tasks. That's a **many-to-many** relationship.

**Why not store them as a comma-separated string?** Because `"work, urgent"` in one column can't be indexed, can only be searched with slow `LIKE '%urgent%'` (which also matches "not-urgent"), and renaming a tag means parsing text across every row.

**The relational design is three tables:**

- `tasks` (unchanged)
- `tags`: `id`, `name TEXT UNIQUE NOT NULL COLLATE NOCASE` (so "Urgent" and "urgent" are the same tag)
- `task_tags` (the junction table): `task_id REFERENCES tasks(id) ON DELETE CASCADE`, `tag_id REFERENCES tags(id) ON DELETE CASCADE`, `PRIMARY KEY (task_id, tag_id)`, plus indexes on both foreign keys

**`ON DELETE CASCADE`** means "if the parent row is deleted, delete the child rows that point to it." Without it, deleting a task that has tags either fails (if foreign keys are enforced) or leaves orphaned rows in `task_tags` pointing at a task that no longer exists.

**The non-obvious thing: a `LEFT JOIN` multiplies rows.** Joining tasks to their tags returns one row *per task-tag pair*, so a task with three tags comes back three times, and React would render it three times. There are three ways to deal with it:

| Approach | How | Tradeoff |
| --- | --- | --- |
| N+1 loop | Get the tasks, then query tags for each task | 100 tasks = 101 queries. Terrible under load. |
| Two queries + stitch | Get the tasks, get all their tags at once with `WHERE task_id IN (...)`, combine in JS | Fast, and what many ORMs do, but you write the stitching code |
| Aggregate in SQL | `GROUP BY tasks.id` with `json_group_array(tags.name)` | One query, one row per task, tags already packed into a JSON array. Cleanest for SQLite. |

```sql
SELECT tasks.*, json_group_array(tags.name) AS tags_json
FROM tasks
LEFT JOIN task_tags ON tasks.id = task_tags.task_id
LEFT JOIN tags ON task_tags.tag_id = tags.id
WHERE tasks.user_id = ?
GROUP BY tasks.id
```

The mapper would `JSON.parse(row.tags_json)` and filter out the `null` you get when a task has no tags.

**Saving tags is several steps** (insert any new tag names with `INSERT ... ON CONFLICT(name) DO NOTHING`, delete the task's old pairings, insert the new ones), so it's wrapped in `db.transaction()`: if any step fails, all of them roll back. Before any of it runs, the route checks that the task belongs to `req.user.userId`.

On the frontend, users type comma-separated tags ("work, urgent"), which get split, trimmed, lowercased, and deduplicated before sending, and each tag renders as a small pill under the task title.

## 14. Planned feature: priority

Priority is the opposite of tags: each task has exactly one, so it's just a column on `tasks`. I'd store it as readable text with a `CHECK` constraint so the database itself rejects anything else:

```sql
priority TEXT NOT NULL DEFAULT 'medium'
  CHECK (priority IN ('low', 'medium', 'high', 'urgent'))
```

The API normalizes the input (`priority.toLowerCase().trim()`), checks it against the same whitelist, and returns 400 if it's not allowed. If it's left out on create, it defaults to `medium`. Like everything else, the create and update queries stay scoped by `user_id`.

**The non-obvious thing: text doesn't sort by urgency.** `ORDER BY priority DESC` sorts alphabetically, which gives urgent, medium, low, high, putting "high" at the very bottom. The fix is mapping each value to a number in the query:

```sql
ORDER BY CASE priority
  WHEN 'urgent' THEN 4
  WHEN 'high'   THEN 3
  WHEN 'medium' THEN 2
  WHEN 'low'    THEN 1
  ELSE 0
END DESC
```

On the frontend it's a controlled `<select>` in the create and edit forms, with a colored badge next to each task.

## 15. Testing

**Three layers, and what each is for:**

- **Integration tests** (what I have): hit the API endpoints and check status codes and response bodies. This is where most of the value is for this app, because the API is the contract.
- **Unit tests:** test one function on its own. In this app there's really only one good candidate, `mapTaskRow`. Everything else is a route (better tested through HTTP) or a query (which needs a database anyway).
- **End-to-end tests:** drive a real browser. The one worth writing here: create a task, refresh, and confirm it's still there. That's the persistence requirement, and it's the one thing the API tests can't prove on their own.

**Two things that make an app testable:**

1. **An injectable database.** If `db.js` always opens the same file, every test run writes into the real development database. Reading the path from an environment variable fixes it:

   ```js
   const db = new Database(process.env.DB_PATH || "tasks.sqlite");
   ```

   Tests set `DB_PATH=":memory:"`, which gives SQLite a database that only exists in memory and disappears when the process ends, so every run starts clean.

2. **Exporting the app separately from `app.listen()`.** Supertest needs to import the Express app without starting a server on a port, so `app` gets exported and `listen()` only runs when the file is started directly.

Testability is a property of how the code is structured, not something you add at the end.

**What integration tests can't catch:** anything in the browser (rendering, state updates, the prepend behavior), the dev proxy setup, real concurrency, and performance.

## 16. Linting: ESLint vs. Oxlint

**Linting** automatically scans code for bugs, bad patterns, and style problems before you run it.

I went with **ESLint** because it's the industry standard. **Oxlint** is newer and written in Rust:

- **Oxlint's strengths:** very fast (it's a compiled, multi-threaded binary that can lint thousands of files in milliseconds), and it comes with React, JSX, and TypeScript rules built in.
- **Its tradeoffs:** it can't run ESLint's JavaScript plugins, so the plugin ecosystem is much smaller, and it doesn't do deep type-aware checks like `no-floating-promises` (catching Promises nobody awaited), which need the full TypeScript type information.

A setup that uses both: Oxlint locally and in pre-commit hooks for instant feedback, and full ESLint with type checks in CI.

## 17. Deploying it on AWS

How I'd deploy this at real scale:

- Put everything in a **VPC** (Virtual Private Cloud), split into public and private subnets.
- **Containerize** the frontend and backend with Docker and push the images to **Amazon ECR**.
- Run the containers as **ECS tasks on Fargate** in the private subnets. Fargate is serverless compute: AWS manages the servers underneath, and an ECS service scales the number of identical tasks up and down with traffic.
- Put an **Application Load Balancer** in the public subnet as the front door. It handles HTTPS and routes traffic to healthy frontend or backend containers.
- Move the database to **Amazon RDS** (Postgres or MySQL) in private database subnets with no public internet access at all. Its security group only allows connections from the backend's security group, and RDS handles backups and maintenance.
- Move the rate limiter's counters to **Redis** (Amazon ElastiCache), because with several backend tasks running, in-memory counters no longer work.
