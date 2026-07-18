const status = document.querySelector("#status");
const code = document.querySelector("#code");
const output = document.querySelector("#output");
const pairing = document.querySelector("#pairing");
const pairingLobby = document.querySelector("#pairing-lobby");
const pairingCode = document.querySelector("#pairing-code");
const tailnet = document.querySelector("#tailnet");
const setOutput = (text) => { output.textContent = text; };

async function refreshStatus() {
  const result = await window.hammy.status();
  status.textContent = !result.cliReady
    ? "Codex CLI is not installed"
    : result.signedIn
    ? `Codex is signed in${result.plan ? ` · ${result.plan}` : ""}${result.paired ? " · relay ready" : ""}`
    : "Codex is not signed in";
  if (result.error) setOutput(result.error);
}

async function refreshTailnet() {
  const result = await window.hammy.tailscale();
  const peers = result.peers.length ? ` Online peers: ${result.peers.map((peer) => peer.name).join(", ")}.` : "";
  tailnet.textContent = `${result.message}${peers}`;
}

document.querySelector("#login").onclick = async () => {
  setOutput("Starting secure Codex sign-in…");
  try {
    const result = await window.hammy.login();
    if (!result.verificationURL || !result.userCode) throw new Error("Codex did not return a device-code sign-in request.");
    code.hidden = false;
    code.querySelector("a").href = result.verificationURL;
    code.querySelector("a").textContent = result.verificationURL;
    code.querySelector("strong").textContent = result.userCode;
    setOutput(`${result.message}\n\nWaiting for you to finish in the browser… then click “Check connection”.`);
  } catch (error) { setOutput(error.message); }
};

document.querySelector("#status-button").onclick = async () => {
  try { await refreshStatus(); setOutput(status.textContent); } catch (error) { setOutput(error.message); }
};

document.querySelector("#pair").onclick = async () => {
  setOutput("Looking for secure pairing requests from Hammy phones…");
  try {
    pairing.hidden = false;
    const result = await window.hammy.pairingLobbies();
    pairingLobby.replaceChildren();
    for (const lobby of result.lobbies) {
      const option = document.createElement("option");
      option.value = lobby.id;
      option.textContent = `Waiting iPhone · expires ${new Date(lobby.expiresAt).toLocaleTimeString()}`;
      pairingLobby.append(option);
    }
    if (result.lobbies.length) {
      setOutput(`${result.lobbies.length} secure pairing request${result.lobbies.length === 1 ? "" : "s"} found. Enter the matching 12-character code from the iPhone to approve exactly that device.`);
      pairingCode.focus();
    } else {
      setOutput("No iPhone pairing requests are waiting. Open Hammy on the phone, tap Pair with Hammy Companion, then choose this button again.");
    }
  } catch (error) { setOutput(error.message); }
};

document.querySelector("#approve-pairing").onclick = async () => {
  try {
    if (!pairingLobby.value) throw new Error("There is no waiting iPhone pairing request yet.");
    setOutput("Confirming the code and creating the phone’s device authorization…");
    const result = await window.hammy.claimPairingLobby(pairingLobby.value, pairingCode.value);
    pairingCode.value = "";
    pairing.hidden = true;
    setOutput(`${result.deviceName} is paired and trusted. It can now receive its own encrypted-relay authorization and decrypt your shared sessions.`);
    await refreshStatus();
  } catch (error) { setOutput(error.message); }
};

document.querySelector("#start-session").onclick = async () => {
  const prompt = document.querySelector("#prompt");
  setOutput("Starting a real Codex turn and sharing only encrypted updates with Hammy…");
  try {
    const result = await window.hammy.startSession(prompt.value);
    prompt.value = "";
    setOutput(`Codex thread started. Hammy is tracking it as encrypted session ${result.relaySessionId}.`);
  } catch (error) { setOutput(error.message); }
};

refreshStatus().catch((error) => setOutput(error.message));
refreshTailnet().catch((error) => { tailnet.textContent = error.message; });
