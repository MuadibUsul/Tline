import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const source = path.join(root, "prisma", "schema.prisma");
const target = path.join(root, "prisma", "postgresql", "schema.prisma");
const schema = await readFile(source, "utf8");
const postgres = schema
  .replace("// Institutional Intelligence — Phase 1 schema (SQLite dev).", "// Generated from ../schema.prisma. Do not edit directly.")
  .replace('provider = "sqlite"', 'provider = "postgresql"');

if (postgres === schema) throw new Error("SQLite datasource declaration was not found.");
await mkdir(path.dirname(target), { recursive: true });
await writeFile(target, postgres);
console.log(path.relative(root, target));
