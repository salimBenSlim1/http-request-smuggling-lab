const express = require("express");
const crypto = require("crypto");
const { Pool } = require("pg");
const cookieParser = require("cookie-parser");

const app = express();

app.use(express.json());
app.use(cookieParser());

const pool = new Pool({
  host: process.env.PGHOST || "127.0.0.1",
  port: Number(process.env.PGPORT) || 5432,
  database: process.env.PGDATABASE || "labdb",
  user: process.env.PGUSER || "labuser",
  password: process.env.PGPASSWORD || "labpass",
});

function generateSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

// See server-a/server.js for why this header check is a deliberate,
// documented bug rather than an oversight.
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  const internalAdmin = req.headers["x-internal-admin"];

  if (internalAdmin === "true") {
    return next();
  }

  if (!auth) {
    return res.status(401).json({
      error: "missing authorization"
    });
  }

  next();
}

app.use((req, res, next) => {
  console.log("----- REQUEST -----");
  console.log("method:", req.method);
  console.log("url:", req.originalUrl);
  console.log("headers:", req.headers);
  console.log("rawHeaders:", req.rawHeaders);
  console.log("------------------");

  next();
});

app.post("/echo", (req, res) => {
  let body = "";

  req.on("data", chunk => {
    body += chunk.toString();
    console.log("chunk:", chunk.toString());
  });

  req.on("end", () => {
    console.log("content-length:", req.headers["content-length"]);
    console.log("body:", body);

    res.json({
      contentLength: req.headers["content-length"],
      body,
    });
  });
});
/*
 * LOGIN
 */
app.post("/login", async (req, res) => {
  const { username, password } = req.body;

  const result = await pool.query(
    `
    SELECT id, username
    FROM users
    WHERE username = $1
      AND password = $2
    `,
    [username, password]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({
      error: "invalid credentials",
    });
  }

  const user = result.rows[0];

  const sessionId = generateSessionId();

  await pool.query(
    `
    INSERT INTO sessions
    (id, user_id, expires_at)
    VALUES ($1, $2, NOW() + INTERVAL '10 minutes')
    `,
    [sessionId, user.id]
  );

  res.cookie("sid", sessionId, {
    httpOnly: true,
    sameSite: "lax",
  });

  res.json({
    message: "verification required",
    username: user.username,
  });
});


/*
 * VERIFY OTP
 */
app.post("/verify", async (req, res) => {
  const { code } = req.body;

  const sessionId = req.cookies.sid;

  if (!sessionId) {
    return res.status(401).json({
      error: "missing session",
    });
  }

  const result = await pool.query(
    `
    SELECT
      s.id,
      s.user_id,
      s.verified,
      s.otp_attempts,
      s.expires_at,
      u.username,
      u.otp_secret
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1
    `,
    [sessionId]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({
      error: "invalid session",
    });
  }

  const session = result.rows[0];

  if (new Date(session.expires_at) < new Date()) {
    return res.status(401).json({
      error: "session expired",
    });
  }

  if (session.otp_attempts >= 5) {
    return res.status(429).json({
      error: "too many attempts",
    });
  }

  /*
   * Deliberate asynchronous boundary.
   *
   * Don't assume this is harmless.
   */
  await new Promise(resolve => setTimeout(resolve, 100));

  if (code === session.otp_secret) {

    await pool.query(
      `
      UPDATE sessions
      SET verified = TRUE
      WHERE id = $1
      `,
      [sessionId]
    );

    return res.json({
      message: "verified",
    });
  }

  await pool.query(
    `
    UPDATE sessions
    SET otp_attempts = otp_attempts + 1
    WHERE id = $1
    `,
    [sessionId]
  );

  res.status(401).json({
    error: "invalid code",
  });
});

app.get("/admin",requireAuth,async (req,res)=>{
    return res.json({
        message:"hello admin"
    })
})
app.post("/inspect-headers", (req, res) => {
  console.log("=== INSPECT HEADERS ===");
  console.log("headers:", req.headers);
  console.log("rawHeaders:", req.rawHeaders);

  res.json({
    headers: req.headers,
    rawHeaders: req.rawHeaders
  });
});
app.post("/inspect", (req, res) => {
  console.log("=== INSPECT ===");
  console.log("headers:", req.headers);
  console.log("rawHeaders:", req.rawHeaders);

  let chunks = [];

  req.on("data", chunk => {
    chunks.push(chunk);
    console.log("BODY CHUNK:", JSON.stringify(chunk.toString()));
  });

  req.on("end", () => {
    const body = Buffer.concat(chunks);

    console.log("BODY LENGTH:", body.length);
    console.log("BODY:", JSON.stringify(body.toString()));

    res.json({
      bodyLength: body.length,
      body: body.toString()
    });
  });
});
/*
 * ACCOUNT
 */
app.get("/account", async (req, res) => {
  const sessionId = req.cookies.sid;

  if (!sessionId) {
    return res.status(401).json({
      error: "missing session",
    });
  }

  const result = await pool.query(
    `
    SELECT
      s.verified,
      u.username,
      u.balance
    FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.id = $1
    `,
    [sessionId]
  );

  if (result.rowCount === 0) {
    return res.status(401).json({
      error: "invalid session",
    });
  }

  const session = result.rows[0];

  if (!session.verified) {
    return res.status(403).json({
      error: "verification required",
    });
  }

  res.json({
    username: session.username,
    balance: session.balance,
    secret: "BANK-ACCOUNT-SECRET",
  });
});


/*
 * LOGOUT
 */
app.post("/logout", async (req, res) => {
  const sessionId = req.cookies.sid;

  if (sessionId) {
    await pool.query(
      `DELETE FROM sessions WHERE id = $1`,
      [sessionId]
    );
  }

  res.clearCookie("sid");

  res.json({
    message: "logged out",
  });
});


app.listen(3002, () => {
  console.log("Server B listening on http://127.0.0.1:3002");
});