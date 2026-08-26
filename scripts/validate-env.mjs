import "dotenv/config";
import path from "node:path";

const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const errors = [];
const warnings = [];
const databaseUrl = process.env.DATABASE_URL || "";
const authSecret = process.env.AUTH_SECRET || "";
const storageDriver = process.env.DOCUMENT_STORAGE_DRIVER || "local";
const storageRoot = process.env.DOCUMENT_STORAGE_ROOT || "./storage";

if (!databaseUrl) errors.push("DATABASE_URL is required.");
if (!["local", "s3"].includes(storageDriver)) errors.push(`DOCUMENT_STORAGE_DRIVER=${storageDriver} has no registered adapter.`);
if (production && storageDriver === "local" && !path.isAbsolute(storageRoot)) {
  errors.push("Production DOCUMENT_STORAGE_ROOT must be an absolute path.");
}
if (storageDriver === "s3" && !process.env.S3_BUCKET) errors.push("S3_BUCKET is required for S3 document storage.");
if (storageDriver === "s3" && !process.env.S3_REGION) errors.push("S3_REGION is required for S3 document storage.");

if (production) {
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) errors.push("Production DATABASE_URL must use PostgreSQL.");
  if (authSecret.length < 32 || /insecure|change-me|dev/i.test(authSecret)) {
    errors.push("Production AUTH_SECRET must be a random value of at least 32 characters.");
  }
  if (process.env.ALLOW_INSECURE_DEMO_AUTH !== "true") {
    warnings.push("Email-only demo sign-in is disabled; configure formal OAuth before enabling accounts.");
  } else {
    warnings.push("ALLOW_INSECURE_DEMO_AUTH=true is suitable only for a private preview.");
  }
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Environment OK (${production ? "production" : "development"}, ${storageDriver} storage).`);
