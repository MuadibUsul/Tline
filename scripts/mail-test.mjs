import "dotenv/config";
import { createTransport } from "nodemailer";

/**
 * Prove — or disprove — that the sign-in link can actually be delivered.
 *
 * When enrolment is by emailed link, a mail service that quietly fails takes registration,
 * recovery and support with it, and the only symptom anyone sees is a message that never
 * arrives. Nothing in the application can distinguish that from a visitor mistyping their
 * address. This asks the mail server directly and prints what it says.
 *
 *   npm run mail:test                          (check configuration and the connection)
 *   npm run mail:test -- --to=you@example.com  (also send a real message)
 */

const arg = (name) => process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);

/** Never print the password embedded in an SMTP URL. */
function redact(server) {
  try {
    const url = new URL(server);
    if (url.password) url.password = "***";
    return url.toString();
  } catch {
    return "(not a URL — nodemailer also accepts a JSON transport object)";
  }
}

async function main() {
  const provider = (process.env.AUTH_PROVIDER || "").toLowerCase();
  const server = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM;

  console.log(`AUTH_PROVIDER : ${provider || "(unset)"}`);
  console.log(`EMAIL_SERVER  : ${server ? redact(server) : "(unset)"}`);
  console.log(`EMAIL_FROM    : ${from || "(unset)"}`);
  console.log("");

  if (provider !== "email") {
    console.log("AUTH_PROVIDER is not \"email\", so NextAuth will not register the email provider and no sign-in link can be sent.");
    console.log("Password sign-in still works: it no longer depends on this.");
  }
  if (!server || !from) {
    console.error("EMAIL_SERVER and EMAIL_FROM must both be set before a link can be sent.");
    process.exitCode = 1;
    return;
  }

  const transport = createTransport(server);
  try {
    await transport.verify();
    console.log("Connection and credentials accepted by the mail server.");
  } catch (error) {
    // The server's own words. "Invalid login", "self signed certificate", "connect
    // ETIMEDOUT" and "Sender address rejected" each need a different fix, and summarising
    // them into "failed" is how an afternoon gets lost.
    console.error("The mail server refused the connection or the credentials:");
    console.error(String(error));
    process.exitCode = 1;
    return;
  }

  const to = arg("to");
  if (!to) {
    console.log("\nNo --to given, so nothing was sent. Add --to=you@example.com to send a real message.");
    return;
  }

  try {
    const info = await transport.sendMail({
      to,
      from,
      subject: "Tline sign-in delivery test",
      text: "This message confirms that sign-in links from this deployment can be delivered. No action is needed.",
    });
    console.log(`\nAccepted for delivery to ${to}.`);
    console.log(`  messageId : ${info.messageId}`);
    if (info.accepted?.length) console.log(`  accepted  : ${info.accepted.join(", ")}`);
    if (info.rejected?.length) console.log(`  rejected  : ${info.rejected.join(", ")}`);
    console.log("\nIf it does not arrive, the message left this server and was dropped after that:");
    console.log("check the provider's dashboard, the sending domain's SPF/DKIM records, and the spam folder.");
  } catch (error) {
    console.error("\nThe mail server accepted the connection but refused the message:");
    console.error(String(error));
    process.exitCode = 1;
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
