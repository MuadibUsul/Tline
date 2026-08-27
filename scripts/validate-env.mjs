import "dotenv/config";
import path from "node:path";

const production = process.argv.includes("--production") || process.env.NODE_ENV === "production";
const errors = [];
const warnings = [];
const databaseUrl = process.env.DATABASE_URL || "";
const authSecret = process.env.AUTH_SECRET || "";
const storageDriver = process.env.DOCUMENT_STORAGE_DRIVER || "local";
const storageRoot = process.env.DOCUMENT_STORAGE_ROOT || "./storage";
const authProvider = (process.env.AUTH_PROVIDER || "").toLowerCase();

if (!databaseUrl) errors.push("DATABASE_URL is required.");
if (!["local", "s3"].includes(storageDriver)) errors.push(`DOCUMENT_STORAGE_DRIVER=${storageDriver} has no registered adapter.`);
if (production && storageDriver === "local" && !path.isAbsolute(storageRoot)) {
  errors.push("Production DOCUMENT_STORAGE_ROOT must be an absolute path.");
}
if (storageDriver === "s3" && !process.env.S3_BUCKET) errors.push("S3_BUCKET is required for S3 document storage.");
if (storageDriver === "s3" && !process.env.S3_REGION) errors.push("S3_REGION is required for S3 document storage.");
if (authProvider && !["azure-ad", "google"].includes(authProvider)) errors.push("AUTH_PROVIDER must be azure-ad or google.");
if (authProvider === "azure-ad" && (!process.env.AZURE_AD_CLIENT_ID || !process.env.AZURE_AD_CLIENT_SECRET)) {
  errors.push("Azure AD OAuth requires AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET.");
}
if (authProvider === "google" && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
  errors.push("Google OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
}

if (production) {
  if (!/^postgres(?:ql)?:\/\//.test(databaseUrl)) errors.push("Production DATABASE_URL must use PostgreSQL.");
  if (authSecret.length < 32 || /insecure|change-me|dev/i.test(authSecret)) {
    errors.push("Production AUTH_SECRET must be a random value of at least 32 characters.");
  }
  if (!authProvider) {
    if (process.env.ALLOW_INSECURE_DEMO_AUTH === "true") {
      warnings.push("ALLOW_INSECURE_DEMO_AUTH=true is suitable only for a private preview.");
    } else {
      warnings.push("Account sign-in is disabled; set AUTH_PROVIDER when accounts are ready.");
    }
  }
  if (authProvider && !process.env.NEXTAUTH_URL) errors.push("NEXTAUTH_URL is required when production OAuth is enabled.");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Environment OK (${production ? "production" : "development"}, ${storageDriver} storage).`);
