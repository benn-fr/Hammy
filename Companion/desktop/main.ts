import { app, BrowserWindow, ipcMain, safeStorage, shell } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { basename, dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const relayURL = process.env.HAMMY_RELAY_URL ?? "https://backend.yzycoin.app";

type DeviceKeys = {
  agreementPrivateKeyPEM: string;
  signingPrivateKeyPEM: string;
  agreementPublicKey: string;
  signingPublicKey: string;
};

type RelayIdentity = {
  email: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken: string;
  keys: DeviceKeys;
  sessions?: Record<string, ManagedSession>;
};

type ManagedSession = {
  relaySessionId: string;
  threadId: string;
  keyId: string;
  sessionKey: string;
  seenEventIDs: string[];
  mirroredItemIDs?: string[];
};
type AsideRun = { session: ManagedSession; emittedReply: boolean };
type CommandResult = { stdout: string; stderr: string };

type RPCResponse = { id?: number; method?: string; params?: any; result?: unknown; error?: { message?: string } };

class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private executable: string | null = null;
  private nextID = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  onNotification: ((method: string, params: any) => void) | null = null;
  onServerRequest: ((method: string, id: number, params: any) => void) | null = null;

  async request(method: string, params: unknown = {}, autoInstall = false): Promise<any> {
    await this.start(autoInstall);
    const id = this.nextID++;
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child!.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response;
  }

  async prepare(): Promise<void> {
    await this.start(true);
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.resolveExecutable(false);
      return true;
    } catch {
      return false;
    }
  }

  private async start(autoInstall: boolean): Promise<void> {
    if (this.child) return;
    const executable = await this.resolveExecutable(autoInstall);
    this.child = spawn(executable, ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    this.child.once("error", (error) => this.rejectAll(new Error(`Codex CLI was not found: ${error.message}`)));
    this.child.once("exit", () => {
      this.child = null;
      this.rejectAll(new Error("Codex app-server stopped."));
    });
    let pendingText = "";
    this.child.stdout.on("data", (chunk: Buffer) => {
      pendingText += chunk.toString();
      const lines = pendingText.split("\n");
      pendingText = lines.pop() ?? "";
      for (const line of lines) this.receive(line);
    });
    this.child.stderr.on("data", () => undefined);
    await this.request("initialize", {
      clientInfo: { name: "hammy_companion", title: "Hammy Companion", version: app.getVersion() },
    });
    this.child.stdin.write(`${JSON.stringify({ method: "initialized", params: {} })}\n`);
  }

  private async resolveExecutable(autoInstall: boolean): Promise<string> {
    if (this.executable && await canRun(this.executable, ["--version"])) return this.executable;
    const pathCandidate = process.platform === "win32" ? "codex.cmd" : "codex";
    if (await canRun(pathCandidate, ["--version"])) {
      this.executable = pathCandidate;
      return pathCandidate;
    }
    if (!autoInstall) throw new Error("Codex CLI is not installed. Choose “Sign in with ChatGPT” and Hammy will install it locally.");

    const npm = process.platform === "win32" ? "npm.cmd" : "npm";
    if (!await canRun(npm, ["--version"])) {
      throw new Error("Hammy needs Node.js/npm to install Codex. Install the current Node.js LTS, reopen Hammy Companion, then sign in.");
    }
    await runCommand(npm, ["install", "--global", "@openai/codex"], 180_000);
    const prefix = (await runCommand(npm, ["prefix", "--global"], 15_000)).stdout.trim();
    const installed = process.platform === "win32" ? join(prefix, "codex.cmd") : join(prefix, "bin", "codex");
    try { await access(installed); } catch {
      throw new Error("Codex installed, but Hammy could not locate its executable. Restart Hammy Companion and try again.");
    }
    if (!await canRun(installed, ["--version"])) throw new Error("Codex installation completed but could not start. Restart Hammy Companion and try again.");
    this.executable = installed;
    return installed;
  }

  private receive(line: string) {
    try {
      const message = JSON.parse(line) as RPCResponse;
      if (typeof message.id !== "number") {
        if (message.method) this.onNotification?.(message.method, message.params);
        return;
      }
      if (message.method) { this.onServerRequest?.(message.method, message.id, message.params); return; }
      const waiter = this.pending.get(message.id);
      if (!waiter) return;
      this.pending.delete(message.id);
      if (message.error) waiter.reject(new Error(message.error.message ?? "Codex app-server request failed."));
      else waiter.resolve(message.result);
    } catch { /* Ignore malformed diagnostic output. */ }
  }

  respond(id: number, result: unknown) {
    this.child?.stdin.write(`${JSON.stringify({ id, result })}\n`);
  }

  private rejectAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error);
    this.pending.clear();
  }
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = ""; let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${command} did not finish in time.`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.trim() || `${command} exited with status ${code ?? "unknown"}.`));
    });
  });
}

async function canRun(command: string, args: string[]): Promise<boolean> {
  try { await runCommand(command, args, 8_000); return true; } catch { return false; }
}

const codex = new CodexAppServer();
const activeTurns = new Set<string>();
const pendingApprovals = new Map<string, { id: number; method: string }>();
const asideRuns = new Map<string, AsideRun>();
let synchronizingCodex = false;

function deviceKeys(): DeviceKeys {
  const agreement = generateKeyPairSync("x25519");
  const signingKey = generateKeyPairSync("ed25519");
  const agreementPublic = agreement.publicKey.export({ format: "jwk" });
  const signingPublic = signingKey.publicKey.export({ format: "jwk" });
  if (!agreementPublic.x || !signingPublic.x) throw new Error("This runtime cannot create raw device keys.");
  return {
    agreementPrivateKeyPEM: agreement.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    signingPrivateKeyPEM: signingKey.privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    agreementPublicKey: agreementPublic.x,
    signingPublicKey: signingPublic.x,
  };
}

function canonicalFields(fields: string[]): Buffer {
  return Buffer.from(`hammy-canonical-v1\n${fields.map((field) => `${Buffer.byteLength(field, "utf8")}:${field}`).join("")}`, "utf8");
}

function approvalSignature(identity: RelayIdentity, pending: { id: string; agreementPublicKey: string; signingPublicKey: string }): string {
  const payload = canonicalFields([
    "hammy.device-approval.signature.v1", identity.userId, identity.deviceId, pending.id,
    pending.agreementPublicKey, pending.signingPublicKey,
  ]);
  return sign(null, payload, createPrivateKey(identity.keys.signingPrivateKeyPEM)).toString("base64url");
}

function b64(value: Uint8Array) { return Buffer.from(value).toString("base64url"); }
function fromB64(value: string, expectedLength?: number) {
  const result = Buffer.from(value, "base64url");
  if (result.toString("base64url") !== value || (expectedLength && result.byteLength !== expectedLength)) throw new Error("Invalid relay encoding.");
  return result;
}

function sessionMetadataAAD(context: { userId: string; sessionId: string; senderDeviceId: string }, envelope: any) {
  return canonicalFields(["hammy.session-metadata.aad.v1", context.userId, context.sessionId, context.senderDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.nonce, envelope.clientCreatedAt]);
}
function sessionMetadataSignature(context: { userId: string; sessionId: string; senderDeviceId: string }, envelope: any) {
  return canonicalFields(["hammy.session-metadata.signature.v1", context.userId, context.sessionId, context.senderDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.nonce, envelope.ciphertext, envelope.clientCreatedAt]);
}
function eventAAD(context: { userId: string; sessionId: string; messageId: string; senderDeviceId: string; notificationHint: string }, envelope: any) {
  return canonicalFields(["hammy.event.aad.v1", context.userId, context.sessionId, context.messageId, context.senderDeviceId, context.notificationHint, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.nonce, envelope.clientCreatedAt]);
}
function eventSignature(context: { userId: string; sessionId: string; messageId: string; senderDeviceId: string; notificationHint: string }, envelope: any) {
  return canonicalFields(["hammy.event.signature.v1", context.userId, context.sessionId, context.messageId, context.senderDeviceId, context.notificationHint, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.nonce, envelope.ciphertext, envelope.clientCreatedAt]);
}
function keyPackageAAD(context: { userId: string; sessionId: string; senderDeviceId: string; recipientDeviceId: string }, envelope: any) {
  return canonicalFields(["hammy.key-package.aad.v1", context.userId, context.sessionId, context.senderDeviceId, context.recipientDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.ephemeralPublicKey, envelope.salt, envelope.nonce, envelope.createdAt]);
}
function keyPackageSignature(context: { userId: string; sessionId: string; senderDeviceId: string; recipientDeviceId: string }, envelope: any) {
  return canonicalFields(["hammy.key-package.signature.v1", context.userId, context.sessionId, context.senderDeviceId, context.recipientDeviceId, String(envelope.version), envelope.algorithm, envelope.keyId, envelope.ephemeralPublicKey, envelope.salt, envelope.nonce, envelope.ciphertext, envelope.createdAt]);
}
function keyPackageInfo(context: { userId: string; sessionId: string; senderDeviceId: string; recipientDeviceId: string }, keyId: string) {
  return canonicalFields(["hammy.key-package.kdf.v1", context.userId, context.sessionId, context.senderDeviceId, context.recipientDeviceId, keyId]);
}
function encryptMetadata(identity: RelayIdentity, session: ManagedSession, plaintext: object) {
  const nonce = randomBytes(12); const clientCreatedAt = new Date().toISOString();
  const header = { version: 1, algorithm: "chacha20-poly1305", keyId: session.keyId, nonce: b64(nonce), clientCreatedAt };
  const context = { userId: identity.userId, sessionId: session.relaySessionId, senderDeviceId: identity.deviceId };
  const cipher = createCipheriv("chacha20-poly1305", fromB64(session.sessionKey, 32), nonce, { authTagLength: 16 });
  const source = Buffer.from(JSON.stringify(plaintext));
  cipher.setAAD(sessionMetadataAAD(context, header), { plaintextLength: source.byteLength });
  const unsigned = { ...header, ciphertext: b64(Buffer.concat([cipher.update(source), cipher.final(), cipher.getAuthTag()])) };
  return { ...unsigned, signature: b64(sign(null, sessionMetadataSignature(context, unsigned), createPrivateKey(identity.keys.signingPrivateKeyPEM))) };
}
function encryptEvent(identity: RelayIdentity, session: ManagedSession, payload: object, notificationHint = "generic") {
  const messageId = randomUUID(); const nonce = randomBytes(12); const clientCreatedAt = new Date().toISOString();
  const header = { version: 1, algorithm: "chacha20-poly1305", keyId: session.keyId, nonce: b64(nonce), clientCreatedAt };
  const context = { userId: identity.userId, sessionId: session.relaySessionId, messageId, senderDeviceId: identity.deviceId, notificationHint };
  const cipher = createCipheriv("chacha20-poly1305", fromB64(session.sessionKey, 32), nonce, { authTagLength: 16 });
  const source = Buffer.from(JSON.stringify(payload));
  cipher.setAAD(eventAAD(context, header), { plaintextLength: source.byteLength });
  const unsigned = { ...header, ciphertext: b64(Buffer.concat([cipher.update(source), cipher.final(), cipher.getAuthTag()])) };
  return { messageId, notificationHint, envelope: { ...unsigned, signature: b64(sign(null, eventSignature(context, unsigned), createPrivateKey(identity.keys.signingPrivateKeyPEM))) } };
}
function wrapSessionKey(identity: RelayIdentity, session: ManagedSession, recipient: { id: string; agreementPublicKey: string }) {
  const context = { userId: identity.userId, sessionId: session.relaySessionId, senderDeviceId: identity.deviceId, recipientDeviceId: recipient.id };
  const ephemeral = generateKeyPairSync("x25519"); const publicKey = ephemeral.publicKey.export({ format: "jwk" });
  if (!publicKey.x) throw new Error("Unable to create a session-key package.");
  const recipientKey = createPublicKey({ key: { kty: "OKP", crv: "X25519", x: recipient.agreementPublicKey }, format: "jwk" });
  const salt = randomBytes(16); const nonce = randomBytes(12);
  const key = Buffer.from(hkdfSync("sha256", diffieHellman({ privateKey: ephemeral.privateKey, publicKey: recipientKey }), salt, keyPackageInfo(context, session.keyId), 32));
  const header = { version: 1, algorithm: "x25519-hkdf-sha256+chacha20-poly1305", keyId: session.keyId, ephemeralPublicKey: publicKey.x, salt: b64(salt), nonce: b64(nonce), createdAt: new Date().toISOString() };
  const cipher = createCipheriv("chacha20-poly1305", key, nonce, { authTagLength: 16 }); const sessionKey = fromB64(session.sessionKey, 32);
  cipher.setAAD(keyPackageAAD(context, header), { plaintextLength: sessionKey.byteLength });
  const unsigned = { ...header, ciphertext: b64(Buffer.concat([cipher.update(sessionKey), cipher.final(), cipher.getAuthTag()])) };
  return { ...unsigned, signature: b64(sign(null, keyPackageSignature(context, unsigned), createPrivateKey(identity.keys.signingPrivateKeyPEM))) };
}

function decryptEvent(identity: RelayIdentity, session: ManagedSession, event: any, senderSigningPublicKey: string) {
  const { envelope } = event;
  const context = { userId: identity.userId, sessionId: session.relaySessionId, messageId: event.messageId, senderDeviceId: event.senderDeviceId, notificationHint: event.notificationHint };
  const { signature, ...unsigned } = envelope;
  const sender = createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: senderSigningPublicKey }, format: "jwk" });
  if (!verify(null, eventSignature(context, unsigned), sender, fromB64(signature, 64))) throw new Error("Relay event signature was invalid.");
  const combined = fromB64(envelope.ciphertext); const nonce = fromB64(envelope.nonce, 12);
  const decipher = createDecipheriv("chacha20-poly1305", fromB64(session.sessionKey, 32), nonce, { authTagLength: 16 });
  decipher.setAAD(eventAAD(context, envelope), { plaintextLength: combined.byteLength - 16 });
  decipher.setAuthTag(combined.subarray(-16));
  return JSON.parse(Buffer.concat([decipher.update(combined.subarray(0, -16)), decipher.final()]).toString("utf8"));
}

async function fetchRelay(path: string, init: RequestInit = {}, accessToken?: string) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const response = await fetch(`${relayURL}${path}`, { ...init, headers });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(body?.error?.message ?? `Relay request failed (${response.status}).`);
  }
  return response.status === 204 ? null : response.json();
}

function vaultPath() { return join(app.getPath("userData"), "hammy-relay-identity.bin"); }

async function loadIdentity(): Promise<RelayIdentity | null> {
  try {
    const encrypted = await readFile(vaultPath());
    if (!safeStorage.isEncryptionAvailable()) throw new Error("OS key protection is unavailable. Set up your system keychain, then reopen Hammy Companion.");
    return JSON.parse(safeStorage.decryptString(encrypted)) as RelayIdentity;
  } catch (error: any) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function saveIdentity(identity: RelayIdentity) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("OS key protection is unavailable. Hammy will not write relay credentials without it.");
  await mkdir(dirname(vaultPath()), { recursive: true });
  await writeFile(vaultPath(), safeStorage.encryptString(JSON.stringify(identity)), { mode: 0o600 });
}

async function account(): Promise<any> {
  return codex.request("account/read", { refreshToken: true });
}

async function ensureRelayIdentity(): Promise<RelayIdentity> {
  const current = await account();
  const email = current?.account?.email;
  if (current?.account?.type !== "chatgpt" || typeof email !== "string") {
    throw new Error("Sign in to ChatGPT in Hammy Companion first. Your ChatGPT token stays inside local Codex.");
  }
  const saved = await loadIdentity();
  if (saved?.email === email) return saved;

  const keys = deviceKeys();
  const password = randomBytes(32).toString("base64url");
  const registered = await fetchRelay("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email,
      password,
      displayName: email.split("@")[0] || "Hammy user",
      device: {
        name: `Hammy Companion (${process.platform})`, platform: "bridge",
        agreementPublicKey: keys.agreementPublicKey, signingPublicKey: keys.signingPublicKey,
      },
    }),
  }) as any;
  const identity: RelayIdentity = {
    email, userId: registered.user.id, deviceId: registered.device.id,
    accessToken: registered.tokens.accessToken, refreshToken: registered.tokens.refreshToken, keys,
  };
  await saveIdentity(identity);
  return identity;
}

async function status() {
  const cliReady = await codex.isAvailable();
  if (!cliReady) return { cliReady: false, signedIn: false, paired: false, plan: null };
  try {
    const result = await account();
    const signedIn = result?.account?.type === "chatgpt";
    const paired = signedIn && await loadIdentity().then(Boolean).catch(() => false);
    return { cliReady: true, signedIn, paired, plan: result?.account?.planType ?? null };
  } catch (error: any) {
    return { cliReady: true, signedIn: false, paired: false, plan: null, error: error?.message ?? "Codex could not be reached." };
  }
}

async function beginLogin() {
  // This is deliberately triggered by the user. It installs only the official
  // Codex package, then keeps the resulting ChatGPT credential inside Codex.
  await codex.prepare();
  const result = await codex.request("account/login/start", { type: "chatgptDeviceCode" });
  if (result?.verificationUrl) await shell.openExternal(result.verificationUrl);
  return {
    verificationURL: result?.verificationUrl ?? null,
    userCode: result?.userCode ?? null,
    loginId: result?.loginId ?? null,
    message: "Open the verification URL and enter the code. Codex completes sign-in locally on this computer.",
  };
}

async function createPairing() {
  const identity = await ensureRelayIdentity();
  const result = await fetchRelay("/v1/pairings", { method: "POST", body: "{}" }, identity.accessToken) as any;
  return { ...result, relayURL };
}

async function pairingStatus(pairingId: string) {
  const identity = await ensureRelayIdentity();
  const status = await fetchRelay(`/v1/pairings/${encodeURIComponent(pairingId)}`, {}, identity.accessToken) as any;
  if (status.device?.trustState === "pending") {
    await fetchRelay(`/v1/devices/${encodeURIComponent(status.device.id)}/approve`, {
      method: "POST", body: JSON.stringify({ signature: approvalSignature(identity, status.device) }),
    }, identity.accessToken);
    await shareSessionKeys(identity, status.device);
    return { state: "approved", deviceName: status.device.name };
  }
  return { state: status.device?.trustState ?? "waiting", deviceName: status.device?.name ?? null };
}

async function pairingLobbies() {
  const identity = await ensureRelayIdentity();
  const result = await fetchRelay("/v1/pairing-lobbies", {}, identity.accessToken) as { lobbies: Array<{ id: string; expiresAt: string; createdAt: string }> };
  return { lobbies: result.lobbies, relayURL };
}

async function shareSessionKeys(identity: RelayIdentity, device: { id: string; agreementPublicKey: string }) {
  for (const session of Object.values(identity.sessions ?? {})) {
    await fetchRelay(`/v1/sessions/${session.relaySessionId}/keys/${device.id}`, {
      method: "PUT", body: JSON.stringify({ envelope: wrapSessionKey(identity, session, device) }),
    }, identity.accessToken);
  }
}

async function claimPairingLobby(lobbyId: string, code: string) {
  const identity = await ensureRelayIdentity();
  const normalizedCode = code.toUpperCase().trim();
  if (!/^[A-HJ-NP-Z2-9]{12}$/.test(normalizedCode)) throw new Error("Enter the 12-character code shown on the iPhone.");
  const result = await fetchRelay(`/v1/pairing-lobbies/${encodeURIComponent(lobbyId)}/claim`, {
    method: "POST", body: JSON.stringify({ code: normalizedCode }),
  }, identity.accessToken) as { device: { id: string; name: string; agreementPublicKey: string; signingPublicKey: string; trustState: string } };
  const device = result.device;
  if (device.trustState === "pending") {
    await fetchRelay(`/v1/devices/${encodeURIComponent(device.id)}/approve`, {
      method: "POST", body: JSON.stringify({ signature: approvalSignature(identity, device) }),
    }, identity.accessToken);
  }
  await shareSessionKeys(identity, device);
  return { state: "approved", deviceName: device.name };
}

async function publish(identity: RelayIdentity, session: ManagedSession, payload: object, notificationHint = "generic") {
  const event = encryptEvent(identity, session, payload, notificationHint);
  await fetchRelay(`/v1/sessions/${session.relaySessionId}/events`, {
    method: "POST", body: JSON.stringify(event),
  }, identity.accessToken);
  session.seenEventIDs = [...session.seenEventIDs, event.messageId].slice(-500);
  await saveIdentity(identity);
}

async function createRelaySession(identity: RelayIdentity, threadId: string, details: {
  title: string;
  projectName: string;
  promptPreview: string;
}) {
  identity.sessions ??= {};
  const existing = identity.sessions[threadId];
  if (existing) return existing;
  const session: ManagedSession = {
    relaySessionId: randomUUID(), threadId, keyId: `hammy.${randomUUID()}`,
    sessionKey: b64(randomBytes(32)), seenEventIDs: [], mirroredItemIDs: [],
  };
  const metadata = encryptMetadata(identity, session, {
    ...details, model: "Auto", intelligence: "Standard", commandsAllowed: true, pluginsAllowed: true,
  });
  await fetchRelay("/v1/sessions", { method: "POST", body: JSON.stringify({ id: session.relaySessionId, encryptedMetadata: metadata }) }, identity.accessToken);
  const devices = await fetchRelay("/v1/devices", {}, identity.accessToken) as { devices: Array<{ id: string; agreementPublicKey: string; trustState: string }> };
  for (const device of devices.devices.filter((item) => item.trustState === "trusted")) {
    await fetchRelay(`/v1/sessions/${session.relaySessionId}/keys/${device.id}`, {
      method: "PUT", body: JSON.stringify({ envelope: wrapSessionKey(identity, session, device) }),
    }, identity.accessToken);
  }
  identity.sessions[threadId] = session;
  await saveIdentity(identity);
  return session;
}

function sessionDetailsFromThread(thread: any) {
  const preview = typeof thread?.preview === "string" && thread.preview.trim()
    ? thread.preview.trim()
    : "Existing Codex session";
  const cwd = typeof thread?.cwd === "string" ? thread.cwd : "";
  return {
    title: typeof thread?.name === "string" && thread.name.trim() ? thread.name.trim().slice(0, 120) : preview.slice(0, 88),
    projectName: cwd ? basename(cwd) || cwd : "Codex CLI",
    promptPreview: preview.slice(0, 240),
  };
}

async function mirrorThreadSnapshot(identity: RelayIdentity, session: ManagedSession) {
  let snapshot: any;
  try { snapshot = await codex.request("thread/read", { threadId: session.threadId, includeTurns: true }); } catch { return; }
  const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : Array.isArray(snapshot?.thread?.turns) ? snapshot.thread.turns : [];
  for (const turn of turns) {
    const items = Array.isArray(turn?.items) ? turn.items : [];
    for (const item of items) {
      const type = String(item?.type ?? "").toLowerCase();
      const role = type.includes("agentmessage") ? "assistant" : type.includes("usermessage") ? "user" : null;
      if (!role) continue;
      const itemId = typeof item?.id === "string" ? item.id : `${session.threadId}:${type}:${nestedText(item) ?? ""}`;
      if (session.mirroredItemIDs?.includes(itemId)) continue;
      const text = nestedText(item);
      if (!text) continue;
      await publish(identity, session, {
        kind: "message", message: {
          id: randomUUID(), role, text, timestamp: new Date().toISOString(), isAside: false,
        },
      });
      session.mirroredItemIDs = [...(session.mirroredItemIDs ?? []), itemId].slice(-1_000);
    }
  }
  await saveIdentity(identity);
}

async function syncCodexSessions() {
  if (synchronizingCodex) return;
  synchronizingCodex = true;
  try {
    const identity = await ensureRelayIdentity();
    const result = await codex.request("thread/list", { limit: 100 });
    const threads = Array.isArray(result?.data) ? result.data : Array.isArray(result?.threads) ? result.threads : [];
    for (const thread of threads) {
      const threadId = typeof thread?.id === "string" ? thread.id : null;
      if (!threadId || thread?.ephemeral || thread?.parentThreadId) continue;
      const isNew = !identity.sessions?.[threadId];
      const session = await createRelaySession(identity, threadId, sessionDetailsFromThread(thread));
      if (isNew) {
        await publish(identity, session, {
          kind: "state", state: "idle", progress: 0, latestUpdate: "Imported from your local Codex history.", agentCount: 0,
        });
      }
      await mirrorThreadSnapshot(identity, session);
    }
  } catch {
    // The companion is allowed to be signed out/offline; the UI surfaces that
    // state and the next interval retries without losing local Codex data.
  } finally {
    synchronizingCodex = false;
  }
}

async function startSession(prompt: string) {
  const cleaned = prompt.trim();
  if (!cleaned) throw new Error("Write a prompt first.");
  const identity = await ensureRelayIdentity();
  const started = await codex.request("thread/start", {});
  const threadId = started?.thread?.id;
  if (typeof threadId !== "string") throw new Error("Codex did not create a thread.");
  const session = await createRelaySession(identity, threadId, {
    title: "Codex session", projectName: "Hammy Companion", promptPreview: cleaned,
  });
  await publish(identity, session, {
    kind: "state", state: "thinking", progress: 0.02, latestUpdate: "Codex is starting the turn.", agentCount: 0,
  });
  await publish(identity, session, {
    kind: "message", message: { id: randomUUID(), role: "user", text: cleaned, timestamp: new Date().toISOString(), isAside: false },
  });
  await codex.request("turn/start", { threadId, input: [{ type: "text", text: cleaned }] });
  return { relaySessionId: session.relaySessionId, threadId };
}

async function startAside(identity: RelayIdentity, session: ManagedSession, text: string) {
  // Asides intentionally use a separate ephemeral Codex thread. They cannot alter
  // the main thread's context, files, or approval state.
  const started = await codex.request("thread/start", { ephemeral: true, sandbox: "read-only" });
  const asideThreadId = started?.thread?.id;
  if (typeof asideThreadId !== "string") throw new Error("Codex did not create Hammy's aside thread.");
  asideRuns.set(asideThreadId, { session, emittedReply: false });
  try {
    await codex.request("turn/start", {
      threadId: asideThreadId,
      approvalPolicy: "never",
      sandboxPolicy: { type: "readOnly", networkAccess: false },
      input: [{
        type: "text",
        text: [
          "You are Hammy, a concise companion for a separate in-progress Codex session.",
          "Answer the user's aside directly in at most four short sentences.",
          "Do not inspect, edit, create, delete, or run anything. Do not claim you can see the main session.",
          `User aside: ${text.trim()}`,
        ].join("\n"),
      }],
    });
  } catch (error) {
    asideRuns.delete(asideThreadId);
    throw error;
  }
}

function nestedText(value: any): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (!value || typeof value !== "object") return null;
  for (const key of ["text", "delta", "content", "message"]) {
    const found = nestedText(value[key]);
    if (found) return found;
  }
  if (Array.isArray(value)) for (const item of value) { const found = nestedText(item); if (found) return found; }
  return null;
}

async function handleCodexNotification(method: string, params: any) {
  const threadId = params?.threadId ?? params?.thread?.id ?? params?.item?.threadId;
  if (typeof threadId !== "string") return;
  const identity = await loadIdentity();
  const session = identity?.sessions?.[threadId];
  const aside = asideRuns.get(threadId);
  if (!identity || (!session && !aside)) return;
  const relaySession = session ?? aside!.session;
  if (method === "turn/started") activeTurns.add(threadId);
  if (method === "turn/completed") {
    activeTurns.delete(threadId);
    if (aside) {
      if (!aside.emittedReply) {
        await publish(identity, relaySession, {
          kind: "message", message: {
            id: randomUUID(), role: "hammy", isAside: true, timestamp: new Date().toISOString(),
            text: "Hammy's separate quick-answer turn ended without a reply. Please try that aside again.",
          },
        });
      }
      asideRuns.delete(threadId);
    } else {
      await publish(identity, relaySession, { kind: "state", state: "complete", progress: 1, latestUpdate: "Codex finished this turn.", agentCount: 0 });
    }
    return;
  }
  if (method === "item/agentMessage/delta") {
    if (!aside) await publish(identity, relaySession, { kind: "state", state: "typing", progress: 0.72, latestUpdate: "Codex is drafting a response.", agentCount: 0 });
    return;
  }
  if (method === "item/completed" && /agentmessage/i.test(String(params?.item?.type ?? ""))) {
    const text = nestedText(params?.item);
    if (text) {
      if (aside) aside.emittedReply = true;
      await publish(identity, relaySession, {
        kind: "message", message: { id: randomUUID(), role: aside ? "hammy" : "assistant", text, timestamp: new Date().toISOString(), isAside: Boolean(aside) },
      });
    }
    return;
  }
  if (method === "item/started") {
    if (aside) return;
    const type = String(params?.item?.type ?? "").toLowerCase();
    const state = type.includes("reason") ? "thinking" : type.includes("command") ? "typing" : "thinking";
    await publish(identity, relaySession, { kind: "state", state, progress: 0.22, latestUpdate: "Codex is working through the next step.", agentCount: 0 });
  }
}

async function handleCodexServerRequest(method: string, id: number, params: any) {
  const threadId = params?.threadId;
  if (typeof threadId !== "string") { codex.respond(id, { decision: "decline" }); return; }
  if (method === "item/commandExecution/requestApproval" || method === "item/fileChange/requestApproval") {
    pendingApprovals.set(threadId, { id, method });
    const identity = await loadIdentity();
    const session = identity?.sessions?.[threadId];
    if (identity && session) {
      await publish(identity, session, {
        kind: "state", state: "waitingApproval", progress: 0.76,
        latestUpdate: params?.reason ?? "Codex is waiting for your approval before it changes anything.", agentCount: 0,
      }, "attention");
    }
    return;
  }
  // Hammy never broadens sandbox permissions or answers arbitrary server requests on the user's behalf.
  codex.respond(id, method === "item/permissions/requestApproval" ? { permissions: [] } : { decision: "decline" });
}

async function consumePhonePrompts() {
  const identity = await loadIdentity();
  if (!identity?.sessions || Object.keys(identity.sessions).length === 0) return;
  const devices = await fetchRelay("/v1/devices", {}, identity.accessToken) as { devices: Array<{ id: string; signingPublicKey: string }> };
  const signingKeys = new Map(devices.devices.map((device) => [device.id, device.signingPublicKey]));
  for (const [threadId, session] of Object.entries(identity.sessions)) {
    const page = await fetchRelay(`/v1/sessions/${session.relaySessionId}/events?limit=500`, {}, identity.accessToken) as { events: any[] };
    for (const event of page.events) {
      if (session.seenEventIDs.includes(event.messageId)) continue;
      session.seenEventIDs.push(event.messageId);
      if (event.senderDeviceId === identity.deviceId) continue;
      const sender = signingKeys.get(event.senderDeviceId);
      if (!sender) continue;
      let payload: any;
      try { payload = decryptEvent(identity, session, event, sender); } catch { continue; }
      const text = payload?.message?.text;
      if (payload?.kind === "mainPrompt" && typeof text === "string" && text.trim()) {
        await publish(identity, session, { kind: "state", state: "thinking", progress: 0.04, latestUpdate: "Hammy delivered your prompt to Codex.", agentCount: 0 });
        if (activeTurns.has(threadId)) await codex.request("turn/steer", { threadId, input: [{ type: "text", text }] });
        else {
          // Imported CLI threads are resumed only when the phone sends work, so
          // merely mirroring history never changes the user's local session.
          await codex.request("thread/resume", { threadId }).catch(() => undefined);
          activeTurns.add(threadId);
          await codex.request("turn/start", { threadId, input: [{ type: "text", text }] });
        }
      }
      if (payload?.kind === "approval") {
        const approval = pendingApprovals.get(threadId);
        if (approval) {
          codex.respond(approval.id, { decision: "accept" });
          pendingApprovals.delete(threadId);
          await publish(identity, session, { kind: "state", state: "typing", progress: 0.78, latestUpdate: "Approved on your iPhone — Codex is continuing.", agentCount: 0 });
        }
      }
      if (payload?.kind === "aside" && typeof text === "string" && text.trim()) {
        try {
          await startAside(identity, session, text);
        } catch (error: any) {
          await publish(identity, session, {
            kind: "message", message: {
              id: randomUUID(), role: "hammy", isAside: true, timestamp: new Date().toISOString(),
              text: `Hammy couldn't start the separate quick-answer turn: ${error?.message ?? "unknown error"}`,
            },
          });
        }
      }
    }
  }
  await saveIdentity(identity);
}

async function tailscaleStatus() {
  const candidates = process.platform === "darwin"
    ? ["tailscale", "/Applications/Tailscale.app/Contents/MacOS/Tailscale"]
    : [process.platform === "win32" ? "tailscale.exe" : "tailscale"];
  for (const candidate of candidates) {
    try {
      const raw = await runCommand(candidate, ["status", "--json"], 8_000);
      const status = JSON.parse(raw.stdout) as { Self?: any; Peer?: Record<string, any> };
      const peers = Object.values(status.Peer ?? {})
        .filter((peer: any) => peer?.Online)
        .map((peer: any) => ({
          name: peer?.HostName ?? peer?.DNSName ?? "Tailnet device",
          os: peer?.OS ?? null,
          online: Boolean(peer?.Online),
        }));
      return {
        available: true,
        self: status.Self?.HostName ?? status.Self?.DNSName ?? null,
        peers,
        message: "Tailscale is available. Hammy pairs through its encrypted relay, so it also works when this phone is away from your Tailnet.",
      };
    } catch { /* Try the next supported location. */ }
  }
  return {
    available: false,
    self: null,
    peers: [],
    message: "Tailscale was not found on this computer. Remote pairing still works through Hammy's encrypted relay.",
  };
}

codex.onNotification = (method, params) => { void handleCodexNotification(method, params).catch(() => undefined); };
codex.onServerRequest = (method, id, params) => { void handleCodexServerRequest(method, id, params).catch(() => codex.respond(id, { decision: "decline" })); };

function createWindow(): void {
  const window = new BrowserWindow({
    width: 860, height: 700, minWidth: 640, minHeight: 560, title: "Hammy Companion",
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: join(root, "preload.js") },
  });
  void window.loadFile(join(root, "../desktop/renderer/index.html"));
}

app.whenReady().then(() => {
  ipcMain.handle("hammy:status", async () => {
    const current = await status();
    if (current.paired) void syncCodexSessions();
    return current;
  });
  ipcMain.handle("hammy:login", beginLogin);
  ipcMain.handle("hammy:pair", createPairing);
  ipcMain.handle("hammy:pair-status", (_event, pairingId: string) => pairingStatus(pairingId));
  ipcMain.handle("hammy:pairing-lobbies", pairingLobbies);
  ipcMain.handle("hammy:claim-pairing-lobby", (_event, lobbyId: string, code: string) => claimPairingLobby(lobbyId, code));
  ipcMain.handle("hammy:tailscale", tailscaleStatus);
  ipcMain.handle("hammy:start-session", (_event, prompt: string) => startSession(prompt));
  setInterval(() => { void consumePhonePrompts().catch(() => undefined); }, 2_000);
  setInterval(() => { void syncCodexSessions(); }, 15_000);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
