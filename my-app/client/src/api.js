const API_BASE = import.meta.env.VITE_API_BASE ?? "/api";

let authToken = localStorage.getItem("token") || null;
//localStorage vs JavaScript memory. The top section is making sure your login status survives a browser refresh.
//"Did they already login previously?" if yes. then graph that token, if no set authToken to null


//a getter function so the React components (like app.jsx) can ask: "Are we logged in right now? Give me the current token."" 
export function getToken() { 
  return authToken;
}

//single source of truth for logging in and logging out
//wehn logging in (token is a string): Updates the in-memory variable authToken = token AND saves it to the browser with
//localStorage.setItem("token", token); -> when logging out (token is null): Clears the in-memory variable and wipes it from the browser disk
export function setToken(token) {
  authToken = token;
  if (token) {
    localStorage.setItem("token", token);
  } else {
    localStorage.removeItem("token");
  }
}

async function request(path, options = {}) { //request is a wrapper. It already did the res.json() work for you

  //Build the headers object, 95% of headers default to the application/json, if the caller requested custom headers than pick those, and 
  //have the || {} for a saftey fallback so the (...) spread operator doesnt crash on undefined
  const headers = {
    "Content-Type" : "application/json",
    ...(options.headers || {}),
  };

  //Conditionally attach the JWT Bearer token, if the user is logging in (authToken is not null), add the Authorization header.
  //if the user is on the login or registration page, authToken is null, so this header is simply skipped
  if (authToken) {
    headers["Authorization"] = `Bearer ${authToken}`;
  }

  //fire the actual native fetch()
  const res = await fetch(`${API_BASE}${path}`, {
    ...options, // Spread method: "POST", body: "...", etc.
    headers, //Inject our merged headers (including Authorization)
  });


  //handle and expired or invalid session (401), if the backend returns 401 Unauthorizaed (the token expired or secret changed), we set the
  //setToken(null) wipes the dead token from memory and localStorage.
  if (res.status === 401) {
    setToken(null);
    if (!path.startsWith("/auth/")) {
      window.location.reload();
    }
    const errData = await res.json().catch(() => null); //res.json() parses that raw JSON string (backend will send an error with the 401)
    //Into a JS object, and the .catch is a defensive net, if the backend returns an empty body, raw text, or an HTML 500/502 error page
    //from a proxy, native res.json() throws an error, adding the => null intercepts the parsing creash and falls back to errData = null
    throw new Error(errData?.error || "invalid email or password"); //.? is optional chaining, Safely checks if errData exists and has an
    //.error property, if errData was set to null then .?error safely evals to undefined instead of throwing a typeError
  }

  // Handle 429 Too Many Requests: DO NOT wipe token, parse Retry-After
  if (res.status === 429) {
    const errData = await res.json().catch(() => null);
    const retryAfter = res.headers.get("Retry-After");
    const suffix = retryAfter ? ` Retry in ${retryAfter}s.` : "";
    throw new Error(errData?.error ? `${errData.error}${suffix}` : `Rate limit exceeded.${suffix}`);
  }

  //handle empty responses (204 no content)
  //When you delete a task your backend returns status 204 with NO Body, if you try to call res.json() on an empty body, JS throws an error
  //this check returns null immediatley and safley exits
  if (res.status === 204) {
    return null;
  }

  //safely parse the response body
  const data = await res.json().catch(() => null);

  //throw on HTTP errors (400,404,409,500,etc)
  if(!res.ok) {
    throw new Error(data?.error || `Request failed with status ${res.status}`);
  }

  //return the parsed data
  return data;
}
/**
 *Big Picture for Auth

 User fills login form in React
       │
       ▼
calls login(email, password)
       │
       ▼
calls request("/auth/login", ...) ────► Express checks credentials and returns { token }
       │
       ▼
request() unpacks res.json() into `data`
       │
       ▼
setToken(data.token) ───► Stores token in localStorage & memory
       │
       ▼
Future calls to listTasks() ───► request() automatically includes Bearer token
 */

// --- Auth Endpoiunts ---

export async function login(email, password) {
  const data = await request("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function register(email, password) {
  const data = await request("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export function logout() {
  setToken(null);
}

// --- Task Endpoints ----


//no need for fetch, becasue our reqeust wrapper is doing all of that and returning the data, so all we need to do is call request
//and pass the path and the method, body, headers, etc.
export async function listTasks() {
  return request("/tasks");
}

export async function createTask(title, description, dueDate) {
  const formattedDueDate = dueDate && dueDate.trim() !== "" && typeof dueDate === "string" ? dueDate.trim() : null;
  
  return request("/tasks", {
    method: "POST",
    body: JSON.stringify({
      title, 
      description,
      dueDate: formattedDueDate,
    }),
  });
}

export async function updateTask(id, updates) { //(*) updates is a single JS object with all the fields we will change
  return request(`/tasks/${id}`, {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}


export async function setCompleted(id, completed) {
    return updateTask(id, { completed });
}

export async function deleteTask(id) {
  return request(`/tasks/${id}`, {
    method: "DELETE",
  });
}

// Alias: the plan refers to this call by both names.
export const setTaskCompleted = setCompleted;
