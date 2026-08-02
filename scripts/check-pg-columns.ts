import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

const TABLES = ["scrapedGroups","projects","tasks","taskDependencies","userPreferences","notes","pmAgentSessions","pmAgentMessages","projectSuggestions","projectChats","syncLogs","sentEmails","knownRecipients","projectRoles","projectMembers","projectIsdData","files"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const t of TABLES) {
    const res = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position`,
      [t]
    );
    console.log(`${t}: ${res.rows.map(r => r.column_name).join(", ")}`);
  }
  await pool.end();
}
main();
