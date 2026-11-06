import { useEffect, useState } from "react";
import {
  listTasks,
  createTask,
  setCompleted,
  deleteTask,
  updateTask,
  login,
  register,
  logout,
  getToken,
} from "./api";

function isOverdue(dueDateString, completed) {
  if (!dueDateString || completed) return false;
  const today = new Date().toISOString().split("T")[0];
  return dueDateString < today;
}

export default function App() {
  const [token, setAuthTokenState] = useState(getToken());

  // Auth form state
  const [isRegisterMode, setIsRegisterMode] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");

  // Task state
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [titleError, setTitleError] = useState("");
  const [editTitleError, setEditTitleError] = useState("");

  // Edit mode state
  const [editingId, setEditingId] = useState(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");

  // Load tasks whenever the user logs in. Skipped while logged out.
  useEffect(() => {
    if (!token) return;

    // Ignore the response if the component unmounts or the token changes mid-request.
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const result = await listTasks();
        if (!cancelled) setTasks(result);
      } catch {
        if (!cancelled) setError("Failed to load tasks");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleAuthSubmit(e) {
    e.preventDefault();
    setAuthError("");

    try {
      if (isRegisterMode) {
        await register(authEmail, authPassword);
      } else {
        await login(authEmail, authPassword);
      }
      setAuthTokenState(getToken());
      setAuthEmail("");
      setAuthPassword("");
    } catch (err) {
      setAuthError(err.message);
    }
  }

  function handleLogout() {
    logout();
    setAuthTokenState(null);
    setTasks([]);
  }

  async function handleSubmit(e) {
    e.preventDefault();

    if (title.trim() === "") {
      setTitleError("Title is required");
      return;
    }

    try {
      const newTask = await createTask(title.trim(), description, dueDate);
      setTasks([newTask, ...tasks]);
      setTitle("");
      setDescription("");
      setDueDate("");
      setTitleError("");
      setError("");
    } catch {
      setError("Failed to create task");
    }
  }

  async function handleToggle(task, e) {
    const next = e.target.checked;
    try {
      const updated = await setCompleted(task.id, next);
      setTasks(tasks.map((t) => (t.id === task.id ? updated : t)));
      setError("");
    } catch {
      setError("Failed to update task");
    }
  }

  async function handleDelete(task) {
    try {
      await deleteTask(task.id);
      setTasks(tasks.filter((t) => t.id !== task.id));
      setError("");
    } catch {
      setError("Failed to delete task");
    }
  }

  function startEditing(task) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDescription(task.description ?? "");
    setEditDueDate(task.dueDate ?? "");
    setEditTitleError("");
    setError("");
  }

  function cancelEditing() {
    setEditingId(null);
    setEditTitle("");
    setEditDescription("");
    setEditDueDate("");
    setEditTitleError("");
  }

  async function handleSaveEdit(taskId) {
    if (editTitle.trim() === "") {
      setEditTitleError("Title cannot be empty");
      return;
    }

    try {
      const updated = await updateTask(taskId, {
        title: editTitle.trim(),
        description: editDescription.trim() !== "" ? editDescription.trim() : null,
        dueDate: editDueDate.trim() !== "" ? editDueDate.trim() : null,
      });

      setTasks(tasks.map((t) => (t.id === taskId ? updated : t)));
      cancelEditing();
      setError("");
    } catch (err) {
      setError(err.message || "Failed to save changes");
    }
  }

  // Logged out: show the sign-in / register screen.
  if (!token) {
    return (
      <div className="container auth-container">
        <h1>{isRegisterMode ? "Create Account" : "Sign In"}</h1>
        {authError && <p className="error">{authError}</p>}
        <form onSubmit={handleAuthSubmit} className="task-form">
          <input
            type="email"
            placeholder="Email address"
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password (min 6 characters)"
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            required
          />
          <button type="submit">{isRegisterMode ? "Register" : "Sign In"}</button>
        </form>
        <p style={{ marginTop: "1rem" }}>
          {isRegisterMode ? "Already have an account?" : "Need an account?"}{" "}
          <button
            type="button"
            className="link-button"
            onClick={() => {
              setIsRegisterMode(!isRegisterMode);
              setAuthError("");
            }}
          >
            {isRegisterMode ? "Sign In" : "Register"}
          </button>
        </p>
      </div>
    );
  }

  return (
    <div className="container">
      <header>
        <h1>Tasks</h1>
        <button type="button" onClick={handleLogout}>
          Log Out
        </button>
      </header>
      {error !== "" && <p className="error">{error}</p>}

      <form className="task-form" onSubmit={handleSubmit}>
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError("");
          }}
        />
        {titleError !== "" && <p>{titleError}</p>}
        <textarea
          placeholder="Description (optional)"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        <button type="submit">Add task</button>
      </form>

      {loading && <p className="loading">Loading…</p>}

      {!loading && tasks.length === 0 && <p className="empty">No tasks yet.</p>}

      <ul className="task-list">
        {tasks.map((task) => {
          const overdue = isOverdue(task.dueDate, task.completed);

          if (editingId === task.id) {
            return (
              <li key={task.id}>
                <div>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => {
                      setEditTitle(e.target.value);
                      if (editTitleError) setEditTitleError("");
                    }}
                    placeholder="Title"
                  />
                  {editTitleError !== "" && <p>{editTitleError}</p>}
                  <textarea
                    rows={2}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    placeholder="Description (optional)"
                  />
                  <input
                    type="date"
                    value={editDueDate}
                    onChange={(e) => setEditDueDate(e.target.value)}
                  />
                </div>
                <div>
                  <button type="button" onClick={() => handleSaveEdit(task.id)}>
                    Save
                  </button>
                  <button type="button" onClick={cancelEditing}>
                    Cancel
                  </button>
                </div>
              </li>
            );
          }

          return (
            <li key={task.id} className="task-row">
              <input
                type="checkbox"
                checked={task.completed}
                onChange={(e) => handleToggle(task, e)}
              />
              <div className="task-body">
                <span className={task.completed ? "task-title done" : "task-title"}>
                  {task.title}
                </span>
                {task.description !== "" && (
                  <p className="task-description">{task.description}</p>
                )}
                <p className="task-meta">{new Date(task.createdAt).toLocaleString()}</p>
                {task.dueDate && (
                  <p className={`task-due ${overdue ? "overdue" : ""}`}>
                    Due: {task.dueDate} {overdue && "(Overdue)"}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => startEditing(task)}>
                Edit
              </button>
              <button
                type="button"
                className="delete-button"
                onClick={() => handleDelete(task)}
              >
                Delete
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
