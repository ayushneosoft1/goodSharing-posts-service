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

pool.on("connect", () => {
  console.log("✅ Postgres connected with trusted CA");
});
