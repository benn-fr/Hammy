const status = document.querySelector("#status");
const code = document.querySelector("#code");
const output = document.querySelector("#output");
const setOutput = (text) => { output.textContent = text; };

async function refreshStatus() {
  const result = await window.hammy.status();
  status.textContent = result.signedIn
    ? `Codex is signed in${result.plan ? ` · ${result.plan}` : ""}${result.paired ? " · relay ready" : ""}`
    : "Codex is not signed in";
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
  setOutput("Creating a one-time pairing code…");
  try {
    const result = await window.hammy.pair();
    const pairing = document.querySelector("#pairing");
    pairing.hidden = false;
    pairing.querySelector("strong").textContent = result.code;
    pairing.querySelector("small").textContent = `Expires ${new Date(result.expiresAt).toLocaleTimeString()}. Enter it in Hammy on your iPhone.`;
    setOutput("Waiting for Hammy to claim this code. Keep this companion open; it will approve only the iPhone that proves knowledge of the code.");
    const poll = async () => {
      try {
        const update = await window.hammy.pairingStatus(result.pairingId);
        if (update.state === "approved") {
          setOutput(`${update.deviceName} is paired and trusted. Your iPhone can now decrypt relay updates.`);
          await refreshStatus();
          return;
        }
        if (update.state === "waiting") window.setTimeout(poll, 1500);
      } catch (error) { setOutput(error.message); }
    };
    window.setTimeout(poll, 1200);
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
