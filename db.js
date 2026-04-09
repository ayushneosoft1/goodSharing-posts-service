import pkg from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;

const caCert = fs.readFileSync(path.resolve("./certs/ca.pem")).toString();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: caCert,
  },
});

export async function runStartupMigrations() {
  console.log("🚀 Starting Postgres startup migrations...");
  const client = await pool.connect();

  try {
    const { rowCount } = await client.query(`
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE t.typname = 'post_category'
        AND n.nspname = 'public'
    `);

    if (rowCount === 0) {
      await client.query(`
        CREATE TYPE public.post_category AS ENUM (
          'BOOK',
          'CLOTH',
          'ELECTRONIC',
          'TOYS'
        );
      `);
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS public.posts (
        id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        title TEXT NOT NULL,
        category public.post_category NOT NULL,
        description TEXT NOT NULL,
        image_url TEXT,
        location TEXT,
        user_id BIGINT NOT NULL,
        is_deleted BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT now(),
        updated_at TIMESTAMP DEFAULT now()
      );
    `);

    console.log("✅ Postgres startup migration completed");
  } catch (err) {
    console.error("⛔ Postgres startup migration failed", err);
    throw err;
  } finally {
    client.release();
  }
}

pool.on("connect", () => {
  console.log("✅ Postgres connected with trusted CA");
});
