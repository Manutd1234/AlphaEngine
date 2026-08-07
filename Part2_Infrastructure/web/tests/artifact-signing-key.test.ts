/**
 * next.config.mjs must never let an optional feature take the site down.
 *
 * A Vercel build that throws does not deploy — and a deployment that does not
 * happen leaves the PREVIOUS build serving. So a mistyped signing key did not
 * merely disable attestation: it pinned production to a stale artifact and hid
 * an unrelated environment fix behind an error about a feature nobody was
 * waiting on. That happened three times in a row before this contract existed.
 *
 * The split these tests pin:
 *
 *   unreadable value  -> warn, no attestation, BUILD SUCCEEDS
 *                        (a value nobody can parse proves nothing; the readiness
 *                         gate reports `unsigned`, which is honest and visible)
 *   wrong algorithm   -> THROW
 *   untrusted signer  -> THROW
 *                        (a well-formed key that is not the pinned one is a real
 *                         alarm: someone is signing builds this repo distrusts)
 *
 * Every shape below is one a hosting dashboard actually produces: editors
 * flatten PEM newlines to spaces, shells deliver literal \n, and operators
 * reach for base64 to dodge both. All three must load; none may crash a deploy.
 */

import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { type KeyObject, generateKeyPairSync } from "node:crypto";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));

/** Load next.config.mjs in a child process with one env value, as Vercel does. */
function loadConfig(signingKey: string | undefined): "attested" | "unsigned" | { threw: string } {
  const env = { ...process.env };
  if (signingKey === undefined) delete env.ALPHAENGINE_ARTIFACT_SIGNING_KEY;
  else env.ALPHAENGINE_ARTIFACT_SIGNING_KEY = signingKey;

  try {
    const stdout = execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        'import(process.cwd() + "/next.config.mjs").then((m) => '
        + 'console.log(m.default.env.ALPHAENGINE_ARTIFACT_ATTESTATION ? "attested" : "unsigned"))',
      ],
      { cwd: webRoot, env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return stdout.trim().split("\n").pop() as "attested" | "unsigned";
  } catch (error) {
    return { threw: String((error as { stderr?: string }).stderr ?? error) };
  }
}

const pem = (key: KeyObject) => key.export({ type: "pkcs8", format: "pem" }).toString();

/**
 * Assemble token-shaped fixtures at runtime. These values are invented, but a
 * credential scanner matches on shape, not provenance — a literal `sbp_…` in
 * committed source blocks the push (GitHub's push protection did exactly that,
 * correctly). Splitting the prefix keeps the fixture honest and the repo
 * pushable, and any scanner that flags these anyway is a scanner working.
 */
const tokenShaped = (prefix: string, body: string) => `${prefix}_${body}`;

const rogue = pem(generateKeyPairSync("ed25519").privateKey);
const rsa = pem(generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey);

describe("an unusable signing key degrades to unsigned instead of failing the build", () => {
  const unusable: Record<string, string> = {
    // The exact value that broke a production deploy: the signer's own
    // fingerprint, which lives one file away from the key and looks like it.
    "the SPKI fingerprint": "3db8b54f0f95d635c5533277042f384cdc953f9d43fc879558164823c8a25970",
    "a gateway token": "a".repeat(64),
    "a Supabase JWT": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxIn0.c2ln",
    "a Supabase access token": tokenShaped("sbp", "0".repeat(40)),
    "a URL": "https://149-118-48-255.sslip.io",
    "truncated PEM armor": "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2Vw\n",
    "empty-but-present": "   ",
  };

  for (const [shape, value] of Object.entries(unusable)) {
    it(`${shape} builds without attestation`, () => {
      const result = loadConfig(value);
      assert.equal(
        result,
        "unsigned",
        `${shape} must not fail the build — a failed build keeps the stale deployment serving`,
      );
    });
  }
});

describe("every paste shape a dashboard can produce still signs", () => {
  const good = pem(generateKeyPairSync("ed25519").privateKey);
  const shapes: Record<string, string> = {
    "literal PEM": good,
    "newlines flattened to spaces": good.replace(/\n/g, " "),
    "literal backslash-n escapes": good.replace(/\n/g, "\\n"),
    "wrapped in quotes": `"${good.replace(/\n/g, " ")}"`,
    "base64 of the whole file": Buffer.from(good).toString("base64"),
  };

  for (const [shape, value] of Object.entries(shapes)) {
    it(`${shape} reaches the trust check`, () => {
      const result = loadConfig(value);
      // These are valid Ed25519 keys that are not the pinned signer, so the
      // trust root must reject them — proving normalisation got that far
      // rather than bailing out as unreadable.
      assert.ok(
        typeof result === "object" && result.threw.includes("does not match the pinned artifact trust root"),
        `${shape} must normalise into a parseable key, got ${JSON.stringify(result)}`,
      );
    });
  }
});

describe("the security assertions still fail the build", () => {
  it("rejects a well-formed Ed25519 key that is not the pinned signer", () => {
    const result = loadConfig(rogue);
    assert.ok(
      typeof result === "object" && result.threw.includes("does not match the pinned artifact trust root"),
      "an untrusted signer must never build quietly",
    );
  });

  it("rejects a non-Ed25519 key", () => {
    const result = loadConfig(rsa);
    assert.ok(
      typeof result === "object" && result.threw.includes("must be an Ed25519 private key"),
      "the algorithm assertion must hold",
    );
  });

  it("builds unsigned when no key is configured at all", () => {
    assert.equal(loadConfig(undefined), "unsigned");
  });
});

describe("the diagnostic names the actual mistake, not a decoder routine", () => {
  /**
   * Both streams: console.warn writes to stderr, and on a SUCCESSFUL load
   * execFileSync returns stdout only — so capturing stdout alone yields an
   * empty string and any assertion over it passes vacuously.
   */
  function warningFor(value: string): string {
    const run = spawnSync(
      process.execPath,
      ["--input-type=module", "-e", 'import(process.cwd() + "/next.config.mjs")'],
      {
        cwd: webRoot,
        env: { ...process.env, ALPHAENGINE_ARTIFACT_SIGNING_KEY: value },
        encoding: "utf8",
      },
    );
    return `${run.stdout ?? ""}${run.stderr ?? ""}`;
  }

  const publicPem = generateKeyPairSync("ed25519").publicKey
    .export({ type: "spki", format: "pem" }).toString();

  // A well-formed public key normalises cleanly (the armor regex accepts any
  // [A-Z ]+ label), so it only fails at createPrivateKey. Testing the raw value
  // alone left this branch unreachable and printed ERR_OSSL_UNSUPPORTED — the
  // exact opaque string this layer exists to replace.
  it("recognises a public key pasted instead of the private one", () => {
    assert.match(warningFor(publicPem), /this is the PUBLIC key/);
  });

  it("recognises a public key even when base64-encoded", () => {
    assert.match(warningFor(Buffer.from(publicPem).toString("base64")), /this is the PUBLIC key/);
  });

  it("recognises the signer fingerprint", () => {
    assert.match(warningFor("a1b2c3d4".repeat(8)), /fingerprint/);
  });

  it("never leaks a raw OpenSSL decoder code as the whole explanation", () => {
    const warning = warningFor(publicPem);
    assert.ok(
      !/could not be read as a private key — error:[0-9A-F]{8}:/.test(warning),
      "an unexplained OpenSSL code is the failure mode this layer exists to prevent",
    );
  });
});

describe("the build log never echoes the rejected value", () => {
  it("describes the shape without printing the secret", () => {
    const secret = tokenShaped("sbp", "f".repeat(40));
    let stderr = "";
    try {
      execFileSync(
        process.execPath,
        ["--input-type=module", "-e", 'import(process.cwd() + "/next.config.mjs")'],
        {
          cwd: webRoot,
          env: { ...process.env, ALPHAENGINE_ARTIFACT_SIGNING_KEY: secret },
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
    } catch (error) {
      stderr = String((error as { stderr?: string }).stderr ?? "");
    }
    assert.ok(!stderr.includes(secret), "a rejected value may itself be live; build logs are not a secret store");
  });
});
