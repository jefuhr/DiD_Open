import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import SftpClient from "ssh2-sftp-client";

import {
  normalizeLandingId,
  normalizeOverrideMessage,
  normalizeOverrideTimestamp
} from "./manual-overrides.js";

function requiredString(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} is required when SFTP is enabled.`);
  return value.trim();
}

function integerInRange(value, name, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be a whole number from ${minimum} through ${maximum}.`);
  }
  return value;
}

function normalizeFingerprint(value) {
  const fingerprint = requiredString(value, "hostKeySha256");
  if (/^SHA256:/i.test(fingerprint)) {
    const encoded = fingerprint.slice(fingerprint.indexOf(":") + 1).trim();
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== 32) throw new TypeError("hostKeySha256 is not a valid SHA256 fingerprint.");
    return bytes.toString("hex");
  }
  const hex = fingerprint.replaceAll(":", "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hex)) throw new TypeError("hostKeySha256 must be an SHA256 fingerprint.");
  return hex;
}

function sameFingerprint(received, expected) {
  const left = Buffer.from(String(received).toLowerCase());
  const right = Buffer.from(String(expected).toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}

export async function loadSftpOverrideConfig({ configPath, rootPath }) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const enabled = parsed.enabled === true;
  const base = {
    enabled,
    pollSeconds: integerInRange(parsed.pollSeconds ?? 10, "pollSeconds", 5, 300),
    readyTimeoutSeconds: integerInRange(parsed.readyTimeoutSeconds ?? 15, "readyTimeoutSeconds", 1, 60)
  };
  if (!enabled) return base;

  const privateKeyPath = requiredString(parsed.privateKeyPath, "privateKeyPath");
  return {
    ...base,
    host: requiredString(parsed.host, "host"),
    port: integerInRange(parsed.port ?? 22, "port", 1, 65_535),
    username: requiredString(parsed.username, "username"),
    privateKeyPath: path.isAbsolute(privateKeyPath) ? privateKeyPath : path.resolve(rootPath, privateKeyPath),
    privateKeyPassphraseEnv: typeof parsed.privateKeyPassphraseEnv === "string" ? parsed.privateKeyPassphraseEnv.trim() : "",
    hostKeySha256: normalizeFingerprint(parsed.hostKeySha256),
    remoteDirectory: path.posix.resolve("/", requiredString(parsed.remoteDirectory, "remoteDirectory"))
  };
}

export function parseSftpOverrideFile(content, expectedLandingId) {
  const expected = normalizeLandingId(expectedLandingId);
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(content) ? content.toString("utf8") : String(content));
  } catch {
    throw new TypeError("The SFTP override file is not valid JSON.");
  }
  const landingId = normalizeLandingId(parsed?.landingId);
  if (landingId !== expected) throw new RangeError(`The SFTP override file is for landing ${landingId}, not landing ${expected}.`);
  const message = normalizeOverrideMessage(parsed?.message);
  return {
    landingId,
    active: Boolean(message),
    message,
    updatedAt: message ? normalizeOverrideTimestamp(parsed.updatedAt, () => null) : null
  };
}

export function createSftpOverridePoller({
  config,
  landingId: landingIdValue,
  cacheService,
  createClient = () => new SftpClient("NYC Ferry override reader"),
  readPrivateKey = (file) => readFile(file, "utf8"),
  environment = process.env,
  logger = console
}) {
  const landingId = normalizeLandingId(landingIdValue);
  const remotePath = config.enabled
    ? path.posix.join(config.remoteDirectory, `${String(landingId).padStart(2, "0")}.json`)
    : null;
  let client = null;
  let timer = null;
  let polling = null;
  let privateKey = null;
  let lastSuccessAt = null;
  let lastError = null;

  async function disconnect() {
    const activeClient = client;
    client = null;
    if (activeClient) await activeClient.end().catch(() => undefined);
  }

  async function connect() {
    if (client) return client;
    privateKey ||= await readPrivateKey(config.privateKeyPath);
    const nextClient = createClient();
    const passphrase = config.privateKeyPassphraseEnv
      ? environment[config.privateKeyPassphraseEnv]
      : undefined;
    try {
      await nextClient.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        privateKey,
        ...(passphrase ? { passphrase } : {}),
        readyTimeout: config.readyTimeoutSeconds * 1_000,
        hostHash: "sha256",
        hostVerifier: (hash) => sameFingerprint(hash, config.hostKeySha256)
      });
    } catch (error) {
      await nextClient.end().catch(() => undefined);
      throw error;
    }
    client = nextClient;
    return client;
  }

  async function performPoll() {
    if (!config.enabled) return { enabled: false };
    try {
      const activeClient = await connect();
      const remote = parseSftpOverrideFile(await activeClient.get(remotePath), landingId);
      const cached = await cacheService.get(landingId);
      if (remote.message !== cached.message || (remote.updatedAt && remote.updatedAt !== cached.updatedAt)) {
        await cacheService.set(landingId, remote.message, { updatedAt: remote.updatedAt });
      }
      lastSuccessAt = new Date().toISOString();
      lastError = null;
      return remote;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await disconnect();
      logger.error(`SFTP notice check failed for landing ${landingId}: ${lastError}`);
      return null;
    }
  }

  async function pollNow() {
    if (!polling) polling = performPoll().finally(() => { polling = null; });
    return polling;
  }

  function start() {
    if (!config.enabled || timer) return;
    void pollNow();
    timer = setInterval(() => void pollNow(), config.pollSeconds * 1_000);
    timer.unref?.();
  }

  async function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (polling) await polling;
    await disconnect();
  }

  function status() {
    return { enabled: config.enabled, remotePath, connected: Boolean(client), lastSuccessAt, lastError };
  }

  return { pollNow, start, stop, status };
}
