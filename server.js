const express      = require("express");
const bcrypt       = require("bcryptjs");
const jwt          = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const mysql        = require("mysql2/promise");
const crypto       = require("crypto");
const nodemailer   = require("nodemailer");

const app = express();
app.use(express.static(__dirname));
app.use(express.json());
app.use(cookieParser());

const JWT_SECRET = "atlanticmetals_secret_2026"; // change this in production

// ─── Email Transporter ───────────────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "",
    pass: process.env.EMAIL_PASS || ""
  }
});

async function sendVerificationEmail(email, firstName, code) {
  try {
    await transporter.sendMail({
      from: '"Atlantic Metals" <no-reply@atlanticmetals.ca>',
      to: email,
      subject: "Verify your Atlantic Metals account",
      html: `
        <div style="font-family:monospace;background:#111;color:#fff;padding:32px;border-radius:12px;max-width:480px">
          <h2 style="color:#c9a84c;margin-top:0">Atlantic Metals</h2>
          <p>Hi ${firstName},</p>
          <p>Your verification code is:</p>
          <div style="background:#0a0a0a;border:1px solid #333;border-radius:8px;padding:20px;text-align:center;font-size:32px;letter-spacing:10px;color:#c9a84c;font-weight:bold;margin:20px 0">
            ${code}
          </div>
          <p style="color:#888;font-size:13px">This code expires in 15 minutes. If you did not create an account you can ignore this email.</p>
        </div>
      `
    });
  } catch (err) {
    console.error("Email send error:", err.message);
  }
}

// ─── MySQL Connection Pool ───────────────────────────────────────────────────
// ⚠️  Update password to match your MySQL setup
const pool = mysql.createPool({
  host:            process.env.DB_HOST     || "localhost",
  port:            process.env.DB_PORT     || 3306,
  user:            process.env.DB_USER     || "root",
  password:        process.env.DB_PASS     || "Haradeep@2007",
  database:        process.env.DB_NAME     || "atlanticmetals",
  waitForConnections: true,
  connectionLimit: 10,
  ssl:             process.env.DB_HOST ? { rejectUnauthorized: false } : false
});

// ─── Helper: safely parse JSON columns ───────────────────────────────────────
function parseJSON(v, fallback = []) {
  if (!v) return fallback;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return fallback; }
  }
  return v;
}

// ─── Create / Migrate Tables ─────────────────────────────────────────────────
async function initDB() {
  const conn = await pool.getConnection();
  try {
    // Users table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id              INT AUTO_INCREMENT PRIMARY KEY,
        first_name      VARCHAR(100) NOT NULL,
        last_name       VARCHAR(100) NOT NULL,
        email           VARCHAR(255) NOT NULL UNIQUE,
        phone           VARCHAR(30),
        password        VARCHAR(255) NOT NULL,
        verified        TINYINT(1) DEFAULT 0,
        verify_code     VARCHAR(6),
        verify_expires  DATETIME,
        addresses       JSON,
        saved_cards     JSON,
        created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Orders table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS orders (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        user_id    INT NOT NULL,
        items      JSON NOT NULL,
        total      DECIMAL(10,2) NOT NULL,
        status     VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Carts table
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS carts (
        user_id    INT PRIMARY KEY,
        items      JSON NOT NULL DEFAULT (JSON_ARRAY()),
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    // Price history table — stores a datapoint every 5 minutes, kept for 24 hours
    await conn.execute(`
      CREATE TABLE IF NOT EXISTS price_history (
        id         INT AUTO_INCREMENT PRIMARY KEY,
        metal_type VARCHAR(10) NOT NULL,
        price      DECIMAL(10,4) NOT NULL,
        timestamp  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_metal_time (metal_type, timestamp)
      )
    `);

    // Migrate existing users table — add new columns if they don't exist yet
    const [cols] = await conn.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
    );
    const existing = cols.map(c => c.COLUMN_NAME);
    if (!existing.includes("phone"))       await conn.execute("ALTER TABLE users ADD COLUMN phone VARCHAR(30)");
    if (!existing.includes("addresses"))   await conn.execute("ALTER TABLE users ADD COLUMN addresses JSON");
    if (!existing.includes("saved_cards")) await conn.execute("ALTER TABLE users ADD COLUMN saved_cards JSON");

    console.log("MySQL tables ready");
  } finally {
    conn.release();
  }
}

initDB()
  .then(() => {
    console.log("MySQL connected");
    // Start background price recorder after DB is ready
    startPriceHistoryWorker();
  })
  .catch(err => {
    console.error("MySQL error:", err.message);
    console.error("Make sure MySQL is running and the database 'atlanticmetals' exists.");
    console.error("Run in MySQL: CREATE DATABASE atlanticmetals;");
  });

// ─── Auth Middleware ──────────────────────────────────────────────────────────
function authRequired(req, res, next) {
  const token = req.cookies.token || req.headers["authorization"]?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Not logged in" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

// ─── Register ────────────────────────────────────────────────────────────────
app.post("/auth/register", async (req, res) => {
  const { firstName, lastName, email, password } = req.body;
  if (!firstName || !lastName || !email || !password)
    return res.status(400).json({ error: "All fields required" });

  try {
    const [rows] = await pool.execute("SELECT id FROM users WHERE email = ?", [email]);
    if (rows.length > 0)
      return res.status(400).json({ code: "EMAIL_EXISTS", error: "Email already registered" });

    const hashed  = await bcrypt.hash(password, 10);
    const code    = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.execute(
      "INSERT INTO users (first_name, last_name, email, password, verify_code, verify_expires) VALUES (?, ?, ?, ?, ?, ?)",
      [firstName, lastName, email, hashed, code, expires]
    );

    await sendVerificationEmail(email, firstName, code);
    res.json({ success: true, message: "Verification code sent" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Verify Email ────────────────────────────────────────────────────────────
app.post("/auth/verify-email", async (req, res) => {
  const { email, code } = req.body;
  if (!email || !code)
    return res.status(400).json({ error: "Email and code required" });

  try {
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE email = ? AND verify_code = ? AND verify_expires > NOW()",
      [email, code]
    );
    if (rows.length === 0)
      return res.status(400).json({ error: "Invalid or expired code. Request a new one." });

    const user = rows[0];
    await pool.execute(
      "UPDATE users SET verified = 1, verify_code = NULL, verify_expires = NULL WHERE id = ?",
      [user.id]
    );

    const name  = `${user.first_name} ${user.last_name}`;
    const token = jwt.sign({ id: user.id, name, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Resend Verification ─────────────────────────────────────────────────────
app.post("/auth/resend-verification", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  try {
    const [rows] = await pool.execute(
      "SELECT * FROM users WHERE email = ? AND verified = 0", [email]
    );
    if (rows.length === 0)
      return res.status(400).json({ error: "Account not found or already verified" });

    const user    = rows[0];
    const code    = crypto.randomInt(100000, 999999).toString();
    const expires = new Date(Date.now() + 15 * 60 * 1000);

    await pool.execute(
      "UPDATE users SET verify_code = ?, verify_expires = ? WHERE id = ?",
      [code, expires, user.id]
    );

    await sendVerificationEmail(email, user.first_name, code);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Login ───────────────────────────────────────────────────────────────────
app.post("/auth/login", async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: "Email and password required" });

  try {
    const [rows] = await pool.execute("SELECT * FROM users WHERE email = ?", [email]);

    if (rows.length === 0)
      return res.status(400).json({ code: "EMAIL_NOT_FOUND", error: "No account found with this email" });

    const user  = rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match)
      return res.status(400).json({ code: "WRONG_PASSWORD", error: "Incorrect password" });

    if (!user.verified)
      return res.status(400).json({ code: "NOT_VERIFIED", error: "Please verify your email before signing in" });

    const name  = `${user.first_name} ${user.last_name}`;
    const token = jwt.sign({ id: user.id, name, email: user.email }, JWT_SECRET, { expiresIn: "7d" });
    res.cookie("token", token, { httpOnly: true, maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.json({ success: true, user: { name, email: user.email } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Logout / Me ─────────────────────────────────────────────────────────────
app.post("/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ success: true });
});

app.get("/auth/me", authRequired, (req, res) => {
  res.json({ user: { name: req.user.name, email: req.user.email } });
});

// ─── Orders ──────────────────────────────────────────────────────────────────
app.post("/orders", authRequired, async (req, res) => {
  const { items, total } = req.body;
  if (!items || !items.length)
    return res.status(400).json({ error: "No items" });

  try {
    const [result] = await pool.execute(
      "INSERT INTO orders (user_id, items, total) VALUES (?, ?, ?)",
      [req.user.id, JSON.stringify(items), total]
    );
    res.json({ success: true, orderId: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/orders", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Cart ─────────────────────────────────────────────────────────────────────
app.get("/cart", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute("SELECT items FROM carts WHERE user_id = ?", [req.user.id]);
    const cart = rows.length > 0 ? parseJSON(rows[0].items) : [];
    res.json({ cart });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/cart", authRequired, async (req, res) => {
  const { cart } = req.body;
  if (!Array.isArray(cart)) return res.status(400).json({ error: "Invalid cart" });
  try {
    await pool.execute(
      "INSERT INTO carts (user_id, items) VALUES (?, ?) ON DUPLICATE KEY UPDATE items = ?",
      [req.user.id, JSON.stringify(cart), JSON.stringify(cart)]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Profile ─────────────────────────────────────────────────────────────────

app.get("/profile", authRequired, async (req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT first_name, last_name, email, phone, addresses, saved_cards FROM users WHERE id = ?",
      [req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: "User not found" });
    const u = rows[0];
    res.json({
      first_name:  u.first_name,
      last_name:   u.last_name,
      email:       u.email,
      phone:       u.phone || "",
      addresses:   parseJSON(u.addresses),
      saved_cards: parseJSON(u.saved_cards)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/profile", authRequired, async (req, res) => {
  const { firstName, lastName, email, phone } = req.body;
  if (!firstName || !lastName || !email)
    return res.status(400).json({ error: "First name, last name and email are required" });

  try {
    const [existing] = await pool.execute(
      "SELECT id FROM users WHERE email = ? AND id != ?",
      [email, req.user.id]
    );
    if (existing.length)
      return res.status(400).json({ error: "Email already in use by another account" });

    await pool.execute(
      "UPDATE users SET first_name = ?, last_name = ?, email = ?, phone = ? WHERE id = ?",
      [firstName, lastName, email, phone || null, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/profile/password", authRequired, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword)
    return res.status(400).json({ error: "Both passwords required" });
  if (newPassword.length < 6)
    return res.status(400).json({ error: "New password must be at least 6 characters" });

  try {
    const [rows] = await pool.execute("SELECT password FROM users WHERE id = ?", [req.user.id]);
    if (!rows.length) return res.status(404).json({ error: "User not found" });

    const match = await bcrypt.compare(currentPassword, rows[0].password);
    if (!match) return res.status(400).json({ error: "Current password is incorrect" });

    const hashed = await bcrypt.hash(newPassword, 10);
    await pool.execute("UPDATE users SET password = ? WHERE id = ?", [hashed, req.user.id]);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/profile/address", authRequired, async (req, res) => {
  const { addr, index } = req.body;
  try {
    const [rows] = await pool.execute("SELECT addresses FROM users WHERE id = ?", [req.user.id]);
    let addresses = rows.length ? parseJSON(rows[0].addresses) : [];

    if (index !== null && index !== undefined && index >= 0) {
      addresses[index] = addr;
    } else {
      addresses.push(addr);
    }

    await pool.execute(
      "UPDATE users SET addresses = ? WHERE id = ?",
      [JSON.stringify(addresses), req.user.id]
    );
    res.json({ success: true, addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/profile/address/:index", authRequired, async (req, res) => {
  const i = parseInt(req.params.index);
  try {
    const [rows] = await pool.execute("SELECT addresses FROM users WHERE id = ?", [req.user.id]);
    let addresses = rows.length ? parseJSON(rows[0].addresses) : [];
    addresses.splice(i, 1);
    await pool.execute(
      "UPDATE users SET addresses = ? WHERE id = ?",
      [JSON.stringify(addresses), req.user.id]
    );
    res.json({ success: true, addresses });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/profile/card", authRequired, async (req, res) => {
  const { card } = req.body;
  try {
    const [rows] = await pool.execute("SELECT saved_cards FROM users WHERE id = ?", [req.user.id]);
    let saved_cards = rows.length ? parseJSON(rows[0].saved_cards) : [];
    saved_cards.push(card);
    await pool.execute(
      "UPDATE users SET saved_cards = ? WHERE id = ?",
      [JSON.stringify(saved_cards), req.user.id]
    );
    res.json({ success: true, saved_cards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/profile/card/:index", authRequired, async (req, res) => {
  const i = parseInt(req.params.index);
  try {
    const [rows] = await pool.execute("SELECT saved_cards FROM users WHERE id = ?", [req.user.id]);
    let saved_cards = rows.length ? parseJSON(rows[0].saved_cards) : [];
    saved_cards.splice(i, 1);
    await pool.execute(
      "UPDATE users SET saved_cards = ? WHERE id = ?",
      [JSON.stringify(saved_cards), req.user.id]
    );
    res.json({ success: true, saved_cards });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
});

// ─── Price History Worker ─────────────────────────────────────────────────────
// Fetches live prices every 5 minutes and saves them to price_history.
// Automatically deletes records older than 24 hours to keep the table lean.

async function recordPrices() {
  try {
    const metals  = ["XAU", "XAG", "XPT", "XPD"];
    const results = {};

    for (const metal of metals) {
      const response = await fetch(`https://api.gold-api.com/price/${metal}`);
      const data     = await response.json();
      results[metal] = data.price;
    }

    // Insert one row per metal
    const conn = await pool.getConnection();
    try {
      for (const [metal, price] of Object.entries(results)) {
        if (price != null) {
          await conn.execute(
            "INSERT INTO price_history (metal_type, price) VALUES (?, ?)",
            [metal, price]
          );
        }
      }

      // Clean up records older than 24 hours
      await conn.execute(
        "DELETE FROM price_history WHERE timestamp < DATE_SUB(NOW(), INTERVAL 24 HOUR)"
      );
    } finally {
      conn.release();
    }

    // Keep the in-memory cache fresh so the /prices endpoint stays fast
    cache.data      = results;
    cache.timestamp = Date.now();

    console.log(`[${new Date().toISOString()}] Price history recorded`);
  } catch (err) {
    console.error("Price history worker error:", err.message);
  }
}

function startPriceHistoryWorker() {
  // Run once immediately so there's data right away
  recordPrices();
  // Then every 5 minutes (300,000 ms)
  setInterval(recordPrices, 5 * 60 * 1000);
  console.log("Price history worker started (runs every 5 minutes)");
}

// ─── Prices ──────────────────────────────────────────────────────────────────
// Returns current prices AND the last 30 historical data points per metal,
// so every client (phone, laptop, etc.) renders the exact same sparkline.

let cache = { data: null, timestamp: 0 };

app.get("/prices", async (req, res) => {
  const now = Date.now();

  try {
    // Refresh spot prices if cache is older than 60 seconds
    if (!cache.data || now - cache.timestamp >= 60000) {
      const metals  = ["XAU", "XAG", "XPT", "XPD"];
      const results = {};
      for (const metal of metals) {
        const response = await fetch(`https://api.gold-api.com/price/${metal}`);
        const data     = await response.json();
        results[metal] = data.price;
      }
      cache.data      = results;
      cache.timestamp = now;
    }

    // Fetch the last 30 history points per metal from the database
    const [historyRows] = await pool.execute(`
      SELECT metal_type, price, timestamp
      FROM price_history
      WHERE timestamp >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      ORDER BY timestamp ASC
    `);

    // Group history by metal and keep only the most recent 30 points each
    const history = { XAU: [], XAG: [], XPT: [], XPD: [] };
    for (const row of historyRows) {
      if (history[row.metal_type] !== undefined) {
        history[row.metal_type].push(parseFloat(row.price));
      }
    }
    // Trim to last 30 points per metal
    for (const metal of Object.keys(history)) {
      if (history[metal].length > 30) {
        history[metal] = history[metal].slice(-30);
      }
    }

    // Return current prices + historical arrays in a single response
    res.json({
      ...cache.data,   // XAU, XAG, XPT, XPD (current spot prices)
      history          // { XAU: [...], XAG: [...], XPT: [...], XPD: [...] }
    });
  } catch (error) {
    console.error("Error fetching prices:", error);
    // Fallback: return last cached data with empty history so the app still works
    res.json({
      XAU: cache.data?.XAU ?? null,
      XAG: cache.data?.XAG ?? null,
      XPT: cache.data?.XPT ?? null,
      XPD: cache.data?.XPD ?? null,
      history: { XAU: [], XAG: [], XPT: [], XPD: [] }
    });
  }
});

app.listen(3000, () => console.log("Server running on http://localhost:3000"));