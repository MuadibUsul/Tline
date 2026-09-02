#!/usr/bin/env node
// Consistent snapshot of the database plus the local document volume.
//
// Ordering matters: the database is captured FIRST, then the files. A file written
// between the two steps is an orphan (harmless); the reverse order would produce
// database rows pointing at documents the backup never captured.
//
//   node scripts/backup.mjs [--out DIR] [--keep N]
//   node scripts/backup.mjs --verify DIR/<snapshot>

import "dotenv/config";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { pipeline } from "node:stream/promises";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const OUT_ROOT = path.resolve(flag("--out", process.env.BACKUP_DIR || "backups"));
const KEEP = Number(flag("--keep", process.env.BACKUP_KEEP || "7"));
const STORAGE_ROOT = path.resolve(process.env.DOCUMENT_STORAGE_ROOT || "storage");
const DATABASE_URL = process.env.DATABASE_URL || "";

async function sha256(file) {
  const hash = createHash("sha256");
  await pipeline(createReadStream(file), hash);
  return hash.digest("hex");
}

function run(command, commandArgs, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, { stdio: ["ignore", "pipe", "pipe"], ...options });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    if (options.stdoutFile) child.stdout.pipe(options.stdoutFile);
    else child.stdout.resume();
    child.on("error", reject);
    child.on("close", (code) => code === 0
      ? resolve()
      : reject(new Error(`${command} exited ${code}: ${stderr.slice(0, 500)}`)));
  });
}

/** SQLite: VACUUM INTO takes a consistent snapshot while writers are still running. */
async function backupSqlite(destination) {
  const source = path.resolve(DATABASE_URL.replace(/^file:/, "").replace(/^\.\//, "prisma/"));
  await fs.access(source);
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${destination.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  return { engine: "sqlite", source };
}

/** PostgreSQL: custom-format dump is compressed and restorable with pg_restore. */
async function backupPostgres(destination) {
  const handle = await fs.open(destination, "w");
  try {
    await run("pg_dump", ["--format=custom", "--no-owner", "--no-acl", DATABASE_URL],
      { stdoutFile: handle.createWriteStream() });
  } finally {
    await handle.close();
  }
  return { engine: "postgresql", source: DATABASE_URL.replace(/:\/\/[^@]*@/, "://***@") };
}

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, base));
    else if (entry.isFile()) out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

/** Documents are content-addressed and never rewritten, so a plain file copy is safe. */
async function backupDocuments(destination) {
  const driver = process.env.DOCUMENT_STORAGE_DRIVER || "local";
  if (driver !== "local") {
    return { driver, skipped: `object storage (${driver}) is backed up by bucket versioning/replication, not by this script` };
  }
  try {
    await fs.access(STORAGE_ROOT);
  } catch {
    return { driver, skipped: "no local document volume present" };
  }
  const files = await walk(STORAGE_ROOT);
  let bytes = 0;
  for (const relative of files) {
    const from = path.join(STORAGE_ROOT, relative);
    const to = path.join(destination, relative);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(from, to);
    bytes += (await fs.stat(to)).size;
  }
  return { driver, root: STORAGE_ROOT, files: files.length, bytes };
}

async function verify(snapshotDir) {
  const manifest = JSON.parse(await fs.readFile(path.join(snapshotDir, "manifest.json"), "utf8"));
  let failures = 0;
  for (const [relative, expected] of Object.entries(manifest.checksums)) {
    const file = path.join(snapshotDir, relative);
    let actual = null;
    try { actual = await sha256(file); } catch { /* missing */ }
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"}  ${relative}`);
  }
  const documents = manifest.documents;
  if (documents?.files !== undefined) {
    const present = (await walk(path.join(snapshotDir, "documents")).catch(() => [])).length;
    const ok = present === documents.files;
    if (!ok) failures += 1;
    console.log(`${ok ? "ok  " : "FAIL"}  documents/ (${present}/${documents.files} files)`);
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nsnapshot verified");
  process.exitCode = failures ? 1 : 0;
}

async function prune() {
  const entries = await fs.readdir(OUT_ROOT, { withFileTypes: true }).catch(() => []);
  const snapshots = entries.filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => entry.name).sort().reverse();
  for (const stale of snapshots.slice(KEEP)) {
    await fs.rm(path.join(OUT_ROOT, stale), { recursive: true, force: true });
    console.log(`pruned ${stale}`);
  }
}

async function main() {
  const verifyTarget = flag("--verify", null);
  if (verifyTarget) return verify(path.resolve(verifyTarget));

  if (!DATABASE_URL) throw new Error("DATABASE_URL is not set.");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const dir = path.join(OUT_ROOT, stamp);
  await fs.mkdir(path.join(dir, "documents"), { recursive: true });

  const isPostgres = /^postgres(ql)?:/.test(DATABASE_URL);
  const dbFile = path.join(dir, isPostgres ? "database.dump" : "database.sqlite");
  const database = isPostgres ? await backupPostgres(dbFile) : await backupSqlite(dbFile);
  const documents = await backupDocuments(path.join(dir, "documents"));

  const checksums = { [path.basename(dbFile)]: await sha256(dbFile) };
  const manifest = {
    createdAt: new Date().toISOString(),
    order: "database captured before documents; extra documents are safe, missing ones are not",
    database: { ...database, bytes: (await fs.stat(dbFile)).size },
    documents,
    checksums,
  };
  await fs.writeFile(path.join(dir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await prune();
  console.log(`\nsnapshot ${dir}`);
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => {
  console.error(`backup failed: ${error.message}`);
  process.exit(1);
});
