import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

// Migrations run with a superuser-equivalent connection (the docker-compose
// default user) since they create roles and grants that recovery_service
// itself doesn't have privileges to create. Point MIGRATE_DATABASE_URL at
// a cloud Postgres (e.g. Supabase's postgres user) to migrate that instead;
// TLS is applied automatically for any non-localhost host.
const bootstrapUrl =
  process.env.MIGRATE_DATABASE_URL ??
  "postgres://recovery:recovery@localhost:5432/revenue_recovery";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, "migrations");

async function main() {
  const isLocal = /localhost|127\.0\.0\.1/.test(bootstrapUrl);
  const client = new pg.Client({
    connectionString: bootstrapUrl,
    ssl: isLocal ? undefined : { rejectUnauthorized: false },
  });
  await client.connect();

  await client.query(`
    create table if not exists schema_migrations (
      name text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await client.query("select name from schema_migrations")).rows.map((r) => r.name)
  );

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`skip  ${file} (already applied)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`apply ${file}`);
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into schema_migrations (name) values ($1)", [file]);
      await client.query("commit");
    } catch (err) {
      await client.query("rollback");
      console.error(`failed ${file}`);
      throw err;
    }
  }

  await client.end();
  console.log("migrations up to date");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
