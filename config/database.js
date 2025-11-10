import pkg from 'pg';
const { Pool } = pkg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initializeDatabase() {
  try {
    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL
      );
    `);
    console.log("✅ Users table ready");

    // Create chats table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS chats (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255),
        user_input TEXT NOT NULL,
        advice_output TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Chats table ready");
  } catch (error) {
    console.error('Database initialization error:', error);
    throw error;
  }
}
