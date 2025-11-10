import express from 'express';
import bcrypt from 'bcrypt';
import { pool } from '../config/database.js';

const router = express.Router();

// Signup route
router.post('/signup', async (req, res) => {
  const { email, password } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    await pool.query('INSERT INTO users (email, password) VALUES ($1, $2)', [email, hashedPassword]);
    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(400).json({ error: 'User already exists or invalid data' });
  }
});

// Login route
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) return res.status(400).json({ error: 'User not found' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: 'Invalid credentials' });

    res.json({ message: 'Login successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Server error' });
  }
});

export default router;
