import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    // Honour the runtime DB_PATH so `drizzle-kit push` writes schema into
    // the SAME file db/connection.ts opens. drizzle-kit's libsql client
    // expects a `file:` URI — bare paths throw URL_INVALID.
    url: process.env.DB_PATH ? `file:${process.env.DB_PATH}` : "file:sqlite.db",
  },
});