import assert from "node:assert/strict";
import test from "node:test";

/**
 * The invariant these protect: a password does not depend on the mail service.
 *
 * It used to. Password sign-in was registered only inside the `email` branch of the
 * provider list, so a deployment whose SMTP settings were missing or wrong had no
 * `password` provider at all — every attempt failed, and the form reported it as "that
 * email and password do not match". Recovery was by emailed link, which was the thing that
 * was broken, so the account was locked out with no way back in.
 *
 * The provider list is built at module load while the predicates read the environment when
 * called, so each case holds its environment in place across both: the import and the
 * assertions run inside `withEnv`. A distinct query string gives each case its own module
 * instance, since a cached one would keep the first case's provider list.
 */
async function withEnv(
  env: Record<string, string | undefined>,
  seed: number,
  body: (mod: typeof import("./auth-config")) => void | Promise<void>,
) {
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    await body(await import(`./auth-config?case=${seed}`) as typeof import("./auth-config"));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const NO_AUTH = {
  AUTH_PROVIDER: undefined,
  EMAIL_SERVER: undefined,
  EMAIL_FROM: undefined,
  GOOGLE_CLIENT_ID: undefined,
  GOOGLE_CLIENT_SECRET: undefined,
  AZURE_AD_CLIENT_ID: undefined,
  AZURE_AD_CLIENT_SECRET: undefined,
};

/**
 * The id NextAuth will actually route on.
 *
 * CredentialsProvider returns `{ id: "credentials", ..., options }` and leaves the caller's
 * own `id` nested inside `options`, which NextAuth merges over the defaults when it builds
 * its routes. Reading the top-level id therefore reports "credentials" for a provider the
 * running application answers as `/api/auth/callback/password`.
 */
const ids = (mod: typeof import("./auth-config")) =>
  mod.authOptions.providers.map((provider) => (provider as { options?: { id?: string } }).options?.id ?? provider.id);

test("a password still works when no mail service is configured", async () => {
  await withEnv(NO_AUTH, 1, (mod) => {
    assert.equal(mod.isPasswordAuthConfigured(), true);
    assert.equal(mod.isEmailAuthConfigured(), false);
    assert.equal(ids(mod).includes("password"), true);
  });
});

test("email configured adds the link provider without displacing the password one", async () => {
  await withEnv({
    ...NO_AUTH,
    AUTH_PROVIDER: "email",
    EMAIL_SERVER: "smtp://user:pass@smtp.example.com:587",
    EMAIL_FROM: "Tline <no-reply@example.com>",
  }, 2, (mod) => {
    assert.equal(mod.isEmailAuthConfigured(), true);
    assert.equal(mod.isPasswordAuthConfigured(), true);
    assert.equal(ids(mod).includes("email"), true);
    assert.equal(ids(mod).includes("password"), true);
  });
});

test("half-configured email does not take password sign-in down with it", async () => {
  // The exact production failure: AUTH_PROVIDER set, SMTP details missing or removed.
  await withEnv({ ...NO_AUTH, AUTH_PROVIDER: "email", EMAIL_FROM: "Tline <no-reply@example.com>" }, 3, (mod) => {
    assert.equal(mod.isEmailAuthConfigured(), false);
    assert.equal(mod.isPasswordAuthConfigured(), true);
    assert.equal(ids(mod).includes("password"), true);
  });
});

test("an external identity provider owns the credential, so no password beside it", async () => {
  await withEnv({
    ...NO_AUTH,
    AUTH_PROVIDER: "google",
    GOOGLE_CLIENT_ID: "client",
    GOOGLE_CLIENT_SECRET: "secret",
  }, 4, (mod) => {
    assert.equal(mod.isPasswordAuthConfigured(), false);
    assert.deepEqual(ids(mod), ["google"]);
  });
});
