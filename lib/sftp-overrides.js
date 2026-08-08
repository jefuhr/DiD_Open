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

function displayFingerprint(hex) {
  return typeof hex === "string" && /^[a-f0-9]{64}$/i.test(hex)
    ? `SHA256:${Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "")}`
    : null;
}

function withStage(error, stage) {
  const staged = error instanceof Error ? error : new Error(String(error));
  if (!staged.sftpStage) staged.sftpStage = stage;
  return staged;
}

function errorCode(error) {
  const namedCode = error?.name && error.name !== "Error" ? error.name : null;
  return String(error?.code || error?.errno || error?.level || namedCode || "SFTP_ERROR");
}

function troubleshootingHint(stage, error) {
  const code = errorCode(error).toUpperCase();
  const message = String(error?.message || error || "").toLowerCase();

  if (stage === "private-key") {
    if (code === "ENOENT") return "The configured privateKeyPath does not exist. Use a project-relative path or a complete absolute path; environment variables and ~ are not expanded.";
    if (code === "EACCES" || code === "EPERM") return "Node cannot read the configured private key. Check the file owner, permissions, and container volume mount.";
    return "The private key could not be loaded. Check privateKeyPath and confirm that the file contains a valid SSH private key.";
  }
  if (stage === "connect") {
    if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "The SFTP hostname could not be resolved. Check DNS and the host value in config/sftp.json.";
    if (code === "ECONNREFUSED") return "The SFTP host rejected the connection. Check the host, port, firewall, and whether the SFTP service is running.";
    if (code === "ETIMEDOUT" || code === "ESOCKETTIMEDOUT") return "The SFTP connection timed out. Check routing, firewall rules, and readyTimeoutSeconds.";
    if (message.includes("host") && (message.includes("verify") || message.includes("fingerprint") || message.includes("denied"))) return "The server host key did not match hostKeySha256. Verify the fingerprint with the SFTP administrator before changing it.";
    if (message.includes("auth") || message.includes("credential") || message.includes("private key")) return "SFTP authentication failed. Confirm the username, authorized public key, private key file, and key passphrase setting.";
    return "The SSH session could not be established. Check the safe target details in /api/health and review the full console error.";
  }
  if (stage === "download") {
    if (code === "2" || code === "ENOENT" || message.includes("no such file") || message.includes("not exist")) return "The landing JSON file was not found. Confirm remoteDirectory, the two-digit file name, and read permissions.";
    if (code === "3" || code === "EACCES" || message.includes("permission denied")) return "The kiosk account cannot read the landing file. Confirm SFTP folder and file permissions.";
    return "The landing file could not be downloaded. Confirm its remote path and the kiosk account's read access.";
  }
  if (stage === "validate") return "The downloaded file failed the override JSON contract. Check UTF-8 JSON, landingId, message length/type, and updatedAt.";
  if (stage === "read-cache" || stage === "write-cache") return "The local override cache could not be accessed. Check state directory permissions and available disk space.";
  return "Review the console error and SFTP configuration, then allow the next polling cycle to retry.";
}

export function describeSftpError(error, stage = error?.sftpStage || "unknown", now = () => new Date().toISOString()) {
  return {
    at: now(),
    stage,
    code: errorCode(error),
    name: error instanceof Error ? error.name : "Error",
    message: error instanceof Error ? error.message : String(error),
    hint: troubleshootingHint(stage, error)
  };
}

export async function loadSftpOverrideConfig({ configPath, rootPath }) {
  const parsed = JSON.parse(await readFile(configPath, "utf8"));
  const enabled = parsed.enabled === true;
  const base = {
    enabled,
    pollSeconds: integerInRange(parsed.pollSeconds ?? 10, "pollSeconds", 5, 300),
    readyTimeoutSeconds: integerInRange(parsed.readyTimeoutSeconds ?? 15, "readyTimeoutSeconds", 1, 60),
    verboseErrors: parsed.verboseErrors !== false
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
  let presentedHostKeySha256 = null;
  let lastAttemptAt = null;
  let lastSuccessAt = null;
  let lastFailureAt = null;
  let lastRecoveryAt = null;
  let lastChangeAt = null;
  let nextPollAt = null;
  let currentError = null;
  let lastError = null;
  let consecutiveFailures = 0;
  let totalAttempts = 0;
  let totalSuccesses = 0;

  async function disconnect() {
    const activeClient = client;
    client = null;
    if (activeClient) await activeClient.end().catch(() => undefined);
  }

  async function connect() {
    if (client) return client;
    if (!privateKey) {
      try {
        privateKey = await readPrivateKey(config.privateKeyPath);
      } catch (error) {
        throw withStage(error, "private-key");
      }
    }
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
        hostVerifier: (hash) => {
          presentedHostKeySha256 = displayFingerprint(hash);
          return sameFingerprint(hash, config.hostKeySha256);
        }
      });
    } catch (error) {
      await nextClient.end().catch(() => undefined);
      throw withStage(error, "connect");
    }
    client = nextClient;
    return client;
  }

  async function performPoll() {
    if (!config.enabled) return { enabled: false };
    totalAttempts += 1;
    lastAttemptAt = new Date().toISOString();
    nextPollAt = new Date(Date.now() + config.pollSeconds * 1_000).toISOString();
    try {
      const activeClient = await connect();
      let content;
      try {
        content = await activeClient.get(remotePath);
      } catch (error) {
        throw withStage(error, "download");
      }
      let remote;
      try {
        remote = parseSftpOverrideFile(content, landingId);
      } catch (error) {
        throw withStage(error, "validate");
      }
      let cached;
      try {
        cached = await cacheService.get(landingId);
      } catch (error) {
        throw withStage(error, "read-cache");
      }
      const changed = remote.message !== cached.message || (remote.updatedAt && remote.updatedAt !== cached.updatedAt);
      if (changed) {
        try {
          await cacheService.set(landingId, remote.message, { updatedAt: remote.updatedAt });
        } catch (error) {
          throw withStage(error, "write-cache");
        }
        lastChangeAt = new Date().toISOString();
        logger.info?.(`[SFTP override] landing=${landingId} state=${remote.active ? "active" : "clear"} remote=${remotePath} updatedAt=${remote.updatedAt || "not-provided"}`);
      }
      lastSuccessAt = new Date().toISOString();
      totalSuccesses += 1;
      if (consecutiveFailures > 0) {
        lastRecoveryAt = lastSuccessAt;
        logger.info?.(`[SFTP override] landing=${landingId} recovered after ${consecutiveFailures} failed poll${consecutiveFailures === 1 ? "" : "s"}.`);
      }
      consecutiveFailures = 0;
      currentError = null;
      return remote;
    } catch (error) {
      const details = describeSftpError(error);
      if (details.stage === "connect" && presentedHostKeySha256) {
        details.hostKeyVerification = {
          configured: displayFingerprint(config.hostKeySha256),
          presented: presentedHostKeySha256,
          matched: presentedHostKeySha256 === displayFingerprint(config.hostKeySha256)
        };
      }
      consecutiveFailures += 1;
      lastFailureAt = details.at;
      currentError = details;
      lastError = details;
      await disconnect();
      const summary = {
        landingId,
        target: `${config.host}:${config.port}`,
        remotePath,
        failure: consecutiveFailures,
        ...details
      };
      const stack = config.verboseErrors && error instanceof Error && error.stack ? `\n${error.stack}` : "";
      logger.error?.(`[SFTP override] ${JSON.stringify(summary)}${stack}`);
      return null;
    }
  }

  async function pollNow() {
    if (!polling) polling = performPoll().finally(() => { polling = null; });
    return polling;
  }

  function start() {
    if (!config.enabled || timer) return;
    logger.info?.(`[SFTP override] enabled landing=${landingId} target=${config.host}:${config.port} remote=${remotePath} interval=${config.pollSeconds}s`);
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
    return {
      enabled: config.enabled,
      state: !config.enabled ? "disabled" : polling ? "checking" : currentError ? "error" : client ? "connected" : "idle",
      target: config.enabled ? { host: config.host, port: config.port, remotePath } : null,
      hostKeyVerification: config.enabled ? {
        configured: displayFingerprint(config.hostKeySha256),
        presented: presentedHostKeySha256,
        matched: presentedHostKeySha256 ? presentedHostKeySha256 === displayFingerprint(config.hostKeySha256) : null
      } : null,
      pollSeconds: config.pollSeconds,
      readyTimeoutSeconds: config.readyTimeoutSeconds,
      verboseErrors: config.verboseErrors,
      connected: Boolean(client),
      checking: Boolean(polling),
      lastAttemptAt,
      lastSuccessAt,
      lastFailureAt,
      lastRecoveryAt,
      lastChangeAt,
      nextPollAt,
      consecutiveFailures,
      totalAttempts,
      totalSuccesses,
      currentError,
      lastError
    };
  }

  return { pollNow, start, stop, status };
}
