import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { Pool } from "pg";

const TABLES = ["scrapedGroups","projects","tasks","taskDependencies","userPreferences","notes","pmAgentSessions","pmAgentMessages","projectSuggestions","projectChats","syncLogs","sentEmails","knownRecipients","projectRoles","projectMembers","projectIsdData","files"];

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  for (const t of TABLES) {
    try {
      const res = await pool.query(`SELECT count(*) FROM "${t}"`);
      console.log(`${t}: ${res.rows[0].count}`);
    } catch (e: any) {
      console.log(`${t}: ERROR ${e.message}`);
    }
  }
  await pool.end();
}
main();
