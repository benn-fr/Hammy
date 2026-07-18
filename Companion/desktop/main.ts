import { app, BrowserWindow, ipcMain, safeStorage } from "electron";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync, randomBytes, randomUUID, sign, verify } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

type ManagedSession = { relaySessionId: string; threadId: string; keyId: string; sessionKey: string; seenEventIDs: string[] };
type AsideRun = { session: ManagedSession; emittedReply: boolean };

type RPCResponse = { id?: number; method?: string; params?: any; result?: unknown; error?: { message?: string } };

class CodexAppServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private nextID = 1;
  private readonly pending = new Map<number, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();
  onNotification: ((method: string, params: any) => void) | null = null;
  onServerRequest: ((method: string, id: number, params: any) => void) | null = null;

  async request(method: string, params: unknown = {}): Promise<any> {
    await this.start();
    const id = this.nextID++;
    const response = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.child!.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return response;
  }

  private async start(): Promise<void> {
    if (this.child) return;
    this.child = spawn("codex", ["app-server", "--listen", "stdio://"], { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
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

const codex = new CodexAppServer();
const activeTurns = new Set<string>();
const pendingApprovals = new Map<string, { id: number; method: string }>();
const asideRuns = new Map<string, AsideRun>();

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
  const result = await account();
  const signedIn = result?.account?.type === "chatgpt";
  const paired = signedIn && await loadIdentity().then(Boolean).catch(() => false);
  return { signedIn, paired, plan: result?.account?.planType ?? null };
}

async function beginLogin() {
  const result = await codex.request("account/login/start", { type: "chatgptDeviceCode" });
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
    return { state: "approved", deviceName: status.device.name };
  }
  return { state: status.device?.trustState ?? "waiting", deviceName: status.device?.name ?? null };
}

async function publish(identity: RelayIdentity, session: ManagedSession, payload: object, notificationHint = "generic") {
  const event = encryptEvent(identity, session, payload, notificationHint);
  await fetchRelay(`/v1/sessions/${session.relaySessionId}/events`, {
    method: "POST", body: JSON.stringify(event),
  }, identity.accessToken);
  session.seenEventIDs = [...session.seenEventIDs, event.messageId].slice(-500);
  await saveIdentity(identity);
}

async function startSession(prompt: string) {
  const cleaned = prompt.trim();
  if (!cleaned) throw new Error("Write a prompt first.");
  const identity = await ensureRelayIdentity();
  const started = await codex.request("thread/start", {});
  const threadId = started?.thread?.id;
  if (typeof threadId !== "string") throw new Error("Codex did not create a thread.");
  const relaySessionId = randomUUID();
  const session: ManagedSession = {
    relaySessionId, threadId, keyId: `hammy.${randomUUID()}`,
    sessionKey: b64(randomBytes(32)), seenEventIDs: [],
  };
  const metadata = encryptMetadata(identity, session, {
    title: "Codex session", projectName: "Hammy Companion", promptPreview: cleaned,
    model: "Auto", intelligence: "Standard", commandsAllowed: true, pluginsAllowed: true,
  });
  await fetchRelay("/v1/sessions", { method: "POST", body: JSON.stringify({ id: relaySessionId, encryptedMetadata: metadata }) }, identity.accessToken);
  const devices = await fetchRelay("/v1/devices", {}, identity.accessToken) as { devices: Array<{ id: string; agreementPublicKey: string; trustState: string }> };
  for (const device of devices.devices.filter((item) => item.trustState === "trusted")) {
    await fetchRelay(`/v1/sessions/${relaySessionId}/keys/${device.id}`, {
      method: "PUT", body: JSON.stringify({ envelope: wrapSessionKey(identity, session, device) }),
    }, identity.accessToken);
  }
  identity.sessions ??= {};
  identity.sessions[threadId] = session;
  await saveIdentity(identity);
  await publish(identity, session, {
    kind: "state", state: "thinking", progress: 0.02, latestUpdate: "Codex is starting the turn.", agentCount: 0,
  });
  await publish(identity, session, {
    kind: "message", message: { id: randomUUID(), role: "user", text: cleaned, timestamp: new Date().toISOString(), isAside: false },
  });
  await codex.request("turn/start", { threadId, input: [{ type: "text", text: cleaned }] });
  return { relaySessionId, threadId };
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
  ipcMain.handle("hammy:status", status);
  ipcMain.handle("hammy:login", beginLogin);
  ipcMain.handle("hammy:pair", createPairing);
  ipcMain.handle("hammy:pair-status", (_event, pairingId: string) => pairingStatus(pairingId));
  ipcMain.handle("hammy:start-session", (_event, prompt: string) => startSession(prompt));
  setInterval(() => { void consumePhonePrompts().catch(() => undefined); }, 2_000);
  createWindow();
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
