import express from 'express';
import { pool } from '../config/database.js';

const router = express.Router();

// Generate advice endpoint
router.post('/generate', async (req, res) => {
  console.log("API /generate called");
  console.log("Request method:", req.method);
  console.log("GEMINI_API_KEY loaded:", process.env.GEMINI_API_KEY ? "YES" : "NO");

  try {
    const { userInput } = req.body || {};

    if (!userInput) {
      console.log("No userInput provided");
      return res.status(400).json({ error: 'userInput is required' });
    }

    console.log("User input:", userInput);

    // Verify API key exists
    if (!process.env.GEMINI_API_KEY) {
      console.error("GEMINI_API_KEY is not set in environment variables");
      return res.status(500).json({ error: 'API key not configured' });
    }

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${process.env.GEMINI_API_KEY}`;

    console.log("Calling Gemini API...");

    const gRes = await fetch(geminiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
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

    console.log("Gemini API response status:", gRes.status);

    const data = await gRes.json();
    console.log("Gemini API response:", JSON.stringify(data, null, 2));

    if (!gRes.ok) {
      console.error('Gemini API error:', data);
      return res.status(gRes.status).json({
        error: data.error?.message || 'Gemini API error',
        details: data
      });
    }

    // Check if response has expected structure
    if (!data.candidates || data.candidates.length === 0) {
      console.error('No candidates in response:', data);
      return res.status(500).json({
        error: 'No response generated',
        details: data
      });
    }

    console.log("Successfully generated response");

    // Return successful response
    return res.status(200).json(data);

  } catch (err) {
    console.error('Server error:', err);
    console.error('Error stack:', err.stack);
    return res.status(500).json({
      error: 'Internal server error',
      message: err.message
    });
  }
});

// Get all chats for a user
router.get('/chats', async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get all chats for this user
    const result = await pool.query(
      'SELECT id, title, user_input, advice_output, created_at, updated_at FROM chats WHERE user_id = $1 ORDER BY updated_at DESC',
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Get a specific chat by ID
router.get('/chats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Get chat
    const result = await pool.query(
      'SELECT id, title, user_input, advice_output, created_at, updated_at FROM chats WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Create a new chat
router.post('/chats', async (req, res) => {
  try {
    const { email, userInput, adviceOutput, title } = req.body;

    if (!email || !userInput || !adviceOutput) {
      return res.status(400).json({ error: 'Email, userInput, and adviceOutput are required' });
    }

    // Get user by email
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Create chat title from first 50 chars of input if not provided
    const chatTitle = title || userInput.substring(0, 50) + (userInput.length > 50 ? '...' : '');

    // Insert new chat
    const result = await pool.query(
      'INSERT INTO chats (user_id, title, user_input, advice_output) VALUES ($1, $2, $3, $4) RETURNING id, title, user_input, advice_output, created_at, updated_at',
      [userId, chatTitle, userInput, adviceOutput]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Update a chat
router.put('/chats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, userInput, adviceOutput, title } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Build update query dynamically
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
      return res.status(400).json({ error: 'No fields to update' });
    }

    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    values.push(id, userId);

    // Update chat
    const result = await pool.query(
      `UPDATE chats SET ${updates.join(', ')} WHERE id = $${paramCount++} AND user_id = $${paramCount} RETURNING id, title, user_input, advice_output, created_at, updated_at`,
      values
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Delete a chat
router.delete('/chats/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    // Get user by email
    const userResult = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const userId = userResult.rows[0].id;

    // Delete chat
    const result = await pool.query(
      'DELETE FROM chats WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    res.json({ message: 'Chat deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
