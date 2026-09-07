import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createInterface } from "node:readline";
import { prisma } from "../src/lib/db";
import { writeAudit } from "../src/lib/audit";
import { hashPassword, passwordProblem, PASSWORD_MIN_LENGTH } from "../src/lib/password";
import { isRole } from "../src/lib/permissions";

/**
 * Set an account's password from the server.
 *
 * The product enrols accounts by emailing a one-time link, which is the right default and
 * the wrong single point of failure: when the mail service is misconfigured or rejects the
 * message, nobody can enrol, nobody can recover, and — because password sign-in used to be
 * registered only alongside the mail provider — nobody could sign in at all. Recovery then
 * required the very channel that was broken.
 *
 * This is the way back in that does not depend on mail. It runs on the host, so holding it
 * is already equivalent to holding the database.
 *
 *   npm run user:password -- --email=you@example.com                 (generates one, prints it once)
 *   npm run user:password -- --email=you@example.com --stdin         (reads it from stdin, not argv)
 *   npm run user:password -- --email=you@example.com --create --role=admin
 *   npm run user:password -- --list
 */

const arg = (name: string) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const flag = (name: string) => process.argv.includes(`--${name}`);

/** Readable, and well past what a password needs to resist guessing. */
function generatePassword(): string {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(20), (byte) => alphabet[byte % alphabet.length]).join("");
}

async function readStdin(): Promise<string> {
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    rl.close();
    return line.trim();
  }
  return "";
}

async function list() {
  const users = await prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { email: true, role: true, passwordHash: true, suspendedAt: true, emailVerified: true, createdAt: true },
  });
  if (!users.length) {
    console.log("No accounts exist yet. Create one with --create.");
    return;
  }
  console.table(users.map((user) => ({
    email: user.email,
    role: user.role,
    password: user.passwordHash ? "set" : "NOT SET",
    suspended: user.suspendedAt ? "yes" : "",
    created: user.createdAt.toISOString().slice(0, 10),
  })));
}

async function main() {
  if (flag("list")) return list();

  const email = arg("email")?.trim().toLowerCase();
  if (!email || !email.includes("@")) {
    console.error("Usage: npm run user:password -- --email=you@example.com [--create] [--role=admin] [--stdin]");
    process.exitCode = 1;
    return;
  }

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    if (!flag("create")) {
      console.error(`No account for ${email}. Pass --create to make one, or --list to see what exists.`);
      process.exitCode = 1;
      return;
    }
    const role = arg("role") ?? "member";
    if (!isRole(role)) {
      console.error("--role must be member, reviewer or admin.");
      process.exitCode = 1;
      return;
    }
    user = await prisma.user.create({
      // Verified on creation: an operator typing this at the server has established the
      // address by other means, and leaving it unverified would gate the account behind
      // the mail service this command exists to work around.
      data: { email, role, emailVerified: new Date() },
    });
    console.log(`Created ${email} with role ${role}.`);
  }

  // Read before the password is set, so the operator is told rather than puzzled when the
  // new password still will not sign in.
  if (user.suspendedAt) {
    console.warn(`WARNING: ${email} is suspended and will be refused at sign-in until it is restored in the console.`);
  }

  const supplied = flag("stdin") ? await readStdin() : arg("password");
  const password = supplied || generatePassword();
  const problem = passwordProblem(password, email);
  if (problem) {
    const reason = {
      short: `at least ${PASSWORD_MIN_LENGTH} characters`,
      long: "shorter than 200 characters",
      email: "not the account's own address",
      common: "not one of the passwords guessed first in every attack",
    }[problem];
    console.error(`That password is rejected: it must be ${reason}.`);
    process.exitCode = 1;
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      // Signs out every existing session, which is what a credential reset should do.
      passwordChangedAt: new Date(),
    },
  });
  await writeAudit({
    actorId: user.id,
    action: "auth.password.set_by_operator",
    targetType: "user",
    targetId: user.id,
    // No password material, and no hint of it: the audit log is read by more people than
    // this command is run by.
    metadata: { email, viaCli: true },
  });

  console.log(`Password set for ${email}. Every existing session was signed out.`);
  if (!supplied) {
    console.log(`\n  ${password}\n`);
    console.log("Shown once. Sign in with it, then change it at /account/password.");
  }
  if (supplied && !flag("stdin")) {
    console.warn("Note: a password passed on the command line is kept in your shell history. Prefer --stdin.");
  }
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
