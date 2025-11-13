import express from "express";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { pool } from "./db.js";
import axios from "axios";

dotenv.config();

const app = express();

app.use(express.json());

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.sendStatus(204);
  }

  next();
});

app.get("/", (req, res) => {
  res.json({ status: "OK", message: "Backend is running" });
});

app.get("/health", (req, res) => {
  res.json({ status: "OK", message: "Server is healthy" });
});

if (process.env.DATABASE_URL) {
  setTimeout(async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL,
          password VARCHAR(255) NOT NULL
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS chats (
          id SERIAL PRIMARY KEY,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255),
          user_input TEXT NOT NULL,
          advice_output TEXT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } catch (error) {
      console.error("Database setup error:", error.message);
    }
  }, 1000);
}

app.post("/signup", async (req, res) => {
  const { email, password, recaptchaToken } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  if (!recaptchaToken) {
    return res.status(400).json({ msg: "reCAPTCHA token is missing." });
  }

  try {
    const verificationURL = "https://www.google.com/recaptcha/api/siteverify";

    const response = await axios.post(verificationURL, null, {
      params: {
        secret: process.env.RECAPTCHA_SECRET_KEY,
        response: recaptchaToken,
      },
    });

    const { success } = response.data;

    if (!success) {
      return res
        .status(400)
        .json({ msg: "reCAPTCHA verification failed. Bot detected." });
    }

    try {
      const hashedPassword = await bcrypt.hash(password, 10);

      await pool.query("INSERT INTO users (email, password) VALUES ($1, $2)", [
        email,
        hashedPassword,
      ]);

      res.status(201).json({ message: "User registered successfully" });
    } catch (error) {
      if (error.code === "23505") {
        res.status(400).json({ error: "User already exists" });
      } else {
        res.status(500).json({ error: "Server error during registration" });
      }
    }
  } catch (error) {
    console.error("Error during reCAPTCHA or registration:", error);
    res.status(500).json({ msg: "Server error" });
  }
});

app.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [
      email,
    ]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).json({ error: "User not found" });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    res.json({ message: "Login successful" });
  } catch (error) {
    res.status(500).json({ error: "Server error during login" });
  }
});

app.post("/api/generate", async (req, res) => {
  try {
    const { userInput } = req.body || {};

    if (!userInput) {
      return res.status(400).json({ error: "userInput is required" });
    }

    if (!process.env.GEMINI_API_KEY) {
      return res.status(500).json({
        error:
          "Gemini API key not configured. Please set GEMINI_API_KEY environment variable.",
      });
    }

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const gRes = await fetch(geminiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              {
                text: `You are a caring AI Maternal Health Assistant helping a pregnant woman. This is a NEW conversation with NO previous context.

Her question: "${userInput}"

CRITICAL: Analyze ONLY this current question to detect its language. Ignore any previous conversations.

- If THIS question is in English → respond entirely in English
- If THIS question is in Urdu script (اردو) → respond entirely in Urdu script
- If THIS question is in Roman Urdu (like "mujhe") → respond entirely in proper Urdu script (اردو)

Response format:
1. Start with one warm, encouraging sentence
2. Create helpful sections using: **Section Heading:**
3. Use bullet points with asterisk: * your advice here
4. Do NOT write "English Response:" or "اردو رسپانس:" or any language labels
5. Do NOT repeat her question
6. Do NOT provide multiple language versions

Start your response now with the warm sentence, then the formatted advice in the detected language of THIS question only.`,
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0.7,
          topK: 40,
          topP: 0.95,
        },
      }),
    });

    const data = await gRes.json();

    if (!gRes.ok) {
      return res.status(gRes.status).json({
        error: data.error?.message || "Gemini API error",
        details: data,
      });
    }

    if (!data.candidates || data.candidates.length === 0) {
      return res.status(500).json({
        error: "No response generated",
        details: data,
      });
    }

    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({
      error: "Internal server error",
      message: err.message,
    });
  }
});

app.get("/api/chats", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      "SELECT id, title, user_input, advice_output, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC",
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/api/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      "SELECT id, title, user_input, advice_output, created_at, updated_at FROM chats WHERE id = $1 AND user_id = $2",
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/chats", async (req, res) => {
  try {
    const { email, userInput, adviceOutput, title } = req.body;

    if (!email || !userInput || !adviceOutput) {
      return res
        .status(400)
        .json({ error: "Email, userInput, and adviceOutput are required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const chatTitle =
      title ||
      userInput.substring(0, 50) + (userInput.length > 50 ? "..." : "");

    const result = await pool.query(
      "INSERT INTO chats (user_id, title, user_input, advice_output) VALUES ($1, $2, $3, $4) RETURNING id, title, user_input, advice_output, created_at, updated_at",
      [userId, chatTitle, userInput, adviceOutput]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/api/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email, userInput, adviceOutput, title } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title);
    }
    if (userInput !== undefined) {
      updates.push(`user_input = $${paramCount++}`);
      values.push(userInput);
    }
    if (adviceOutput !== undefined) {
      updates.push(`advice_output = $${paramCount++}`);
      values.push(adviceOutput);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: "No fields to update" });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, userId);

    const result = await pool.query(
      `UPDATE chats SET ${updates.join(
        ", "
      )} WHERE id = $${paramCount++} AND user_id = $${paramCount} RETURNING id, title, user_input, advice_output, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/api/chats/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const userResult = await pool.query(
      "SELECT id FROM users WHERE email = $1",
      [email]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const userId = userResult.rows[0].id;

    const result = await pool.query(
      "DELETE FROM chats WHERE id = $1 AND user_id = $2 RETURNING id",
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found" });
    }

    res.json({ message: "Chat deleted successfully" });
  } catch (error) {
    res.status(500).json({ error: "Server error" });
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: "Internal server error" });
});

export default app;

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
