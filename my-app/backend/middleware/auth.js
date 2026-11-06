const jwt = require("jsonwebtoken");

// Set JWT_SECRET in the environment. The fallback is for local development only.
const JWT_SECRET = process.env.JWT_SECRET || "dev-only-secret-change-me";

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production");
}

function signToken(userId) {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: "7d" });
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Unauthorized: missing or malformed token" });
  }

  const token = authHeader.slice(7).trim();

  try {
    // Payload: { userId, iat, exp }. Routes read the user ID from here, never from the request body.
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Unauthorized: invalid or expired token" });
  }
}

module.exports = { signToken, requireAuth };
