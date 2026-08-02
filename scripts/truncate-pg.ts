import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

const TABLES = ["scrapedGroups","projects","tasks","taskDependencies","userPreferences","notes","pmAgentSessions","pmAgentMessages","projectSuggestions","projectChats","syncLogs","sentEmails","knownRecipients","projectRoles","projectMembers","projectIsdData","files"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  // TRUNCATE with CASCADE to reset all rows
  await pool.query(`TRUNCATE "${TABLES.join('", "')}" RESTART IDENTITY CASCADE`);
  console.log("Truncated all tables.");
  await pool.end();
}
main();
