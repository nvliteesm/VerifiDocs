// Applies db/migrations/*.sql in filename order, each in its own transaction.
// Usage: npm run db:migrate [-- --allow-main]
// Refuses to run against the Neon `main` branch unless --allow-main is passed.
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const MIGRATIONS_DIR = join(process.cwd(), "db", "migrations");

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED;
  if (!url) {
    throw new Error("DATABASE_URL_UNPOOLED is not set. Migrations use the unpooled connection.");
  }

  const branch = process.env.NEON_BRANCH ?? "unknown";
  if (branch !== "dev" && !process.argv.includes("--allow-main")) {
    throw new Error(
      `Refusing to migrate branch "${branch}". Use the dev branch, or pass --allow-main on purpose.`,
    );
  }

  const sql = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await sql`
      create table if not exists schema_migrations (
        name       text primary key,
        applied_at timestamptz not null default now()
      )`;

    const applied = new Set(
      (await sql<{ name: string }[]>`select name from schema_migrations`).map((row) => row.name),
    );

    const files = (await readdir(MIGRATIONS_DIR)).filter((file) => file.endsWith(".sql")).sort();
    let ran = 0;

    for (const file of files) {
      if (applied.has(file)) {
        console.log(`skip   ${file} (already applied)`);
        continue;
      }
      const text = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into schema_migrations (name) values (${file})`;
      });
      console.log(`apply  ${file}`);
      ran += 1;
    }

    console.log(`done on branch "${branch}": ${ran} applied, ${files.length - ran} skipped`);
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
