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
const positiveNumber = (name, fallback) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value) || value < 0) errors.push(`${name} must be a non-negative number.`);
};

if (!databaseUrl) errors.push("DATABASE_URL is required.");
if (!["local", "s3"].includes(storageDriver)) errors.push(`DOCUMENT_STORAGE_DRIVER=${storageDriver} has no registered adapter.`);
if (production && storageDriver === "local" && !path.isAbsolute(storageRoot)) {
  errors.push("Production DOCUMENT_STORAGE_ROOT must be an absolute path.");
}
if (storageDriver === "s3" && !process.env.S3_BUCKET) errors.push("S3_BUCKET is required for S3 document storage.");
if (storageDriver === "s3" && !process.env.S3_REGION) errors.push("S3_REGION is required for S3 document storage.");
if (authProvider && !["azure-ad", "email", "google"].includes(authProvider)) errors.push("AUTH_PROVIDER must be azure-ad, email or google.");
if (authProvider === "azure-ad" && (!process.env.AZURE_AD_CLIENT_ID || !process.env.AZURE_AD_CLIENT_SECRET)) {
  errors.push("Azure AD OAuth requires AZURE_AD_CLIENT_ID and AZURE_AD_CLIENT_SECRET.");
}
if (authProvider === "google" && (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)) {
  errors.push("Google OAuth requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
}
if (authProvider === "email" && (!process.env.EMAIL_SERVER || !process.env.EMAIL_FROM)) {
  errors.push("Email authentication requires EMAIL_SERVER and EMAIL_FROM.");
}
for (const [name, fallback] of [["MARKET_BUDGET_PER_MINUTE", 8], ["MARKET_BUDGET_PER_DAY", 800], ["MARKET_QUOTE_ENDPOINT_WEIGHT", 1], ["MARKET_TIME_SERIES_ENDPOINT_WEIGHT", 1], ["TWELVE_DATA_DECLARED_DELAY_SECONDS", 0]]) positiveNumber(name, fallback);
const themeCoverage = Number(process.env.THEME_MARKET_MIN_COVERAGE ?? 0.6);
if (!Number.isFinite(themeCoverage) || themeCoverage < 0 || themeCoverage > 1) errors.push("THEME_MARKET_MIN_COVERAGE must be between 0 and 1.");
try { new Intl.DateTimeFormat("en", { timeZone: process.env.MARKET_BUDGET_RESET_TIMEZONE || "UTC" }).format(); }
catch { errors.push("MARKET_BUDGET_RESET_TIMEZONE must be a valid IANA timezone."); }

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
  if (authProvider && !process.env.NEXTAUTH_URL) errors.push("NEXTAUTH_URL is required when production authentication is enabled.");
  // robots.txt, sitemap.xml and Open Graph URLs are wrong without a real origin.
  const siteUrl = process.env.SITE_URL || process.env.NEXTAUTH_URL || "";
  if (!siteUrl) errors.push("SITE_URL is required in production; canonical and machine-readable URLs must be explicit.");
  else if (!/^https:\/\//.test(siteUrl)) errors.push("Production SITE_URL must use https.");
  const alertWebhook = process.env.ALERT_WEBHOOK_URL || "";
  if (alertWebhook && !/^https:\/\//.test(alertWebhook)) errors.push("ALERT_WEBHOOK_URL must use https.");
  const healthToken = process.env.HEALTH_DETAIL_TOKEN || "";
  if (healthToken && healthToken.length < 24) errors.push("HEALTH_DETAIL_TOKEN must be at least 24 characters.");
}

for (const warning of warnings) console.warn(`WARN: ${warning}`);
if (errors.length) {
  for (const error of errors) console.error(`ERROR: ${error}`);
  process.exit(1);
}
console.log(`Environment OK (${production ? "production" : "development"}, ${storageDriver} storage).`);
