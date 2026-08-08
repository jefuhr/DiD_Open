import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createManualOverrideService } from "../lib/manual-overrides.js";
import {
  createSftpOverridePoller,
  describeSftpError,
  loadSftpOverrideConfig,
  parseSftpOverrideFile
} from "../lib/sftp-overrides.js";

test("loads and validates enabled SFTP configuration", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-sftp-config-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = path.join(directory, "sftp.json");
  await writeFile(configPath, JSON.stringify({
    enabled: true,
    host: "sftp.example.org",
    port: 22,
    username: "reader",
    privateKeyPath: "secrets/id_ed25519",
    hostKeySha256: `SHA256:${Buffer.alloc(32, 7).toString("base64")}`,
    remoteDirectory: "/overrides",
    pollSeconds: 12,
    readyTimeoutSeconds: 8
  }));

  const config = await loadSftpOverrideConfig({ configPath, rootPath: directory });
  assert.equal(config.enabled, true);
  assert.equal(config.privateKeyPath, path.join(directory, "secrets/id_ed25519"));
  assert.equal(config.hostKeySha256, Buffer.alloc(32, 7).toString("hex"));
  assert.equal(config.pollSeconds, 12);
});

test("parses active and blank landing files while rejecting the wrong landing", () => {
  assert.deepEqual(parseSftpOverrideFile(JSON.stringify({
    landingId: 10,
    message: " Landing temporarily closed. ",
    updatedAt: "2026-08-06T14:30:00Z"
  }), 10), {
    landingId: 10,
    active: true,
    message: "Landing temporarily closed.",
    updatedAt: "2026-08-06T14:30:00.000Z"
  });
  assert.equal(parseSftpOverrideFile('{"landingId":10,"message":""}', 10).active, false);
  assert.throws(() => parseSftpOverrideFile('{"landingId":9,"message":"Wrong file"}', 10), /not landing 10/);
});

test("reports actionable SFTP errors without exposing credentials", () => {
  const missingKey = Object.assign(new Error("no such file or directory"), { code: "ENOENT" });
  const details = describeSftpError(missingKey, "private-key", () => "2026-08-08T12:00:00.000Z");
  assert.deepEqual(details, {
    at: "2026-08-08T12:00:00.000Z",
    stage: "private-key",
    code: "ENOENT",
    name: "Error",
    message: "no such file or directory",
    hint: "The configured privateKeyPath does not exist. Use a project-relative path or a complete absolute path; environment variables and ~ are not expanded."
  });

  const authentication = describeSftpError(new Error("All configured authentication methods failed"), "connect");
  assert.match(authentication.hint, /authentication failed/i);
  assert.equal(authentication.code, "SFTP_ERROR");
  assert.doesNotMatch(JSON.stringify(authentication), /private-key-content|super-secret/);
});

test("health status includes the failed stage, retry counters, and safe target details", async () => {
  const logged = [];
  const missingKey = Object.assign(new Error("key file missing"), { code: "ENOENT" });
  const poller = createSftpOverridePoller({
    config: {
      enabled: true,
      host: "sftp.example.org",
      port: 22,
      username: "reader",
      privateKeyPath: "/missing/key",
      privateKeyPassphraseEnv: "",
      hostKeySha256: Buffer.alloc(32, 5).toString("hex"),
      remoteDirectory: "/overrides",
      pollSeconds: 10,
      readyTimeoutSeconds: 5,
      verboseErrors: false
    },
    landingId: 10,
    cacheService: { get: async () => ({ message: "", updatedAt: null }), set: async () => undefined },
    readPrivateKey: async () => { throw missingKey; },
    logger: { error(line) { logged.push(line); } }
  });

  assert.equal(await poller.pollNow(), null);
  const status = poller.status();
  assert.equal(status.state, "error");
  assert.deepEqual(status.target, { host: "sftp.example.org", port: 22, remotePath: "/overrides/10.json" });
  assert.equal(status.totalAttempts, 1);
  assert.equal(status.totalSuccesses, 0);
  assert.equal(status.consecutiveFailures, 1);
  assert.equal(status.currentError.stage, "private-key");
  assert.equal(status.currentError.code, "ENOENT");
  assert.match(status.currentError.hint, /privateKeyPath/);
  assert.equal(logged.length, 1);
  assert.match(logged[0], /"stage":"private-key"/);
  assert.doesNotMatch(logged[0], /reader|private-key-content/);
});

test("host verification failures report configured and presented fingerprints", async () => {
  const configured = Buffer.alloc(32, 5).toString("hex");
  const presented = Buffer.alloc(32, 9).toString("hex");
  const poller = createSftpOverridePoller({
    config: {
      enabled: true,
      host: "sftp.example.org",
      port: 22,
      username: "reader",
      privateKeyPath: "/test/key",
      privateKeyPassphraseEnv: "",
      hostKeySha256: configured,
      remoteDirectory: "/overrides",
      pollSeconds: 10,
      readyTimeoutSeconds: 5,
      verboseErrors: false
    },
    landingId: 10,
    cacheService: { get: async () => ({ message: "", updatedAt: null }), set: async () => undefined },
    readPrivateKey: async () => "test-private-key",
    createClient: () => ({
      async connect(options) {
        assert.equal(options.hostVerifier(presented), false);
        throw new Error("getConnection: Host denied (verification failed)");
      },
      async end() {}
    }),
    logger: { error() {} }
  });

  await poller.pollNow();
  assert.deepEqual(poller.status().currentError.hostKeyVerification, {
    configured: `SHA256:${Buffer.from(configured, "hex").toString("base64").replace(/=+$/, "")}`,
    presented: `SHA256:${Buffer.from(presented, "hex").toString("base64").replace(/=+$/, "")}`,
    matched: false
  });
});

test("polls the configured landing file and stores the last valid notice locally", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "nycf-sftp-poll-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const cacheService = createManualOverrideService({ statePath: path.join(directory, "manual-overrides.json") });
  const calls = { connect: 0, paths: [], end: 0 };
  const fingerprint = Buffer.alloc(32, 5).toString("hex");
  const responses = [
    '{"landingId":10,"message":"Use the alternate boarding area.","updatedAt":"2026-08-06T15:00:00Z"}',
    '{"landingId":10,"message":"","updatedAt":"2026-08-06T15:05:00Z"}'
  ];
  const fakeClient = {
    async connect(options) {
      calls.connect += 1;
      assert.equal(options.hostVerifier(fingerprint), true);
    },
    async get(remotePath) {
      calls.paths.push(remotePath);
      return Buffer.from(responses.shift());
    },
    async end() { calls.end += 1; }
  };
  const poller = createSftpOverridePoller({
    config: {
      enabled: true,
      host: "sftp.example.org",
      port: 22,
      username: "reader",
      privateKeyPath: "/test/key",
      privateKeyPassphraseEnv: "",
      hostKeySha256: fingerprint,
      remoteDirectory: "/overrides",
      pollSeconds: 10,
      readyTimeoutSeconds: 5
    },
    landingId: 10,
    cacheService,
    createClient: () => fakeClient,
    readPrivateKey: async () => "test-private-key",
    logger: { error() {} }
  });

  await poller.pollNow();
  assert.equal((await cacheService.get(10)).message, "Use the alternate boarding area.");
  await poller.pollNow();
  assert.equal((await cacheService.get(10)).active, false);
  assert.deepEqual(calls.paths, ["/overrides/10.json", "/overrides/10.json"]);
  assert.equal(calls.connect, 1);
  assert.equal(poller.status().totalAttempts, 2);
  assert.equal(poller.status().totalSuccesses, 2);
  assert.equal(poller.status().consecutiveFailures, 0);
  await poller.stop();
  assert.equal(calls.end, 1);
});
