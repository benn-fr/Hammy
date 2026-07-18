const output = document.querySelector("#output");
const setOutput = (value) => { output.textContent = value || "Completed."; };
const run = async (action, label) => {
  setOutput(`${label}…`);
  try {
    const result = await action();
    setOutput(result.output || (result.code === 0 ? "Completed." : "Codex returned an error."));
  } catch (error) { setOutput(error.message); }
};
document.querySelector("#status").onclick = () => run(window.hammy.status, "Checking Codex status");
document.querySelector("#login").onclick = () => run(window.hammy.login, "Waiting for local Codex sign-in");
document.querySelector("#start").onclick = () => run(window.hammy.start, "Starting local pairing");
document.querySelector("#pair").onclick = () => run(window.hammy.pair, "Creating pairing code");
window.hammy.onOutput((text) => { output.textContent += text; });
