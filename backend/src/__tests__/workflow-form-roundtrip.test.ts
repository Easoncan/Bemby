import { describe, expect, it } from "vitest";
import { buildSync } from "esbuild";
import path from "node:path";
import { runInNewContext } from "node:vm";

// Compile the real form converters without importing the SPA or adding another test runner.
const source = path.resolve(__dirname, "../../../frontend/src/composables/customActions.ts");
const compiled = buildSync({ entryPoints: [source], bundle: true, platform: "node", format: "cjs", write: false });
const mod = { exports: {} as Record<string, (value: any) => any> };
runInNewContext(compiled.outputFiles[0].text, { module: mod, exports: mod.exports }, { timeout: 1000 });
const { actionFromConfig, actionToConfig } = mod.exports;

describe("workflow editor configuration round trips", () => {
  it("retains conditions and fresh Telegram reply references", () => {
    const action = { type: "click_message_button", id: "confirm", contact: "bot", button: "Confirm", afterStep: "login_send", match: "exact", maxRetries: 1, maxWaitMs: 30000, when: { variable: "logged_in", operator: "equals", value: "false" } };
    expect(actionToConfig(actionFromConfig(action))).toEqual(action);
  });

  it("keeps variable extraction, visibility checks and text targeting editable", () => {
    const action = { type: "web_steps", session: "panel", maxWaitMs: 120000, maxRetries: 1, steps: [
      { type: "web_extract", selector: "#command", source: "text", saveAs: "command", pattern: "(\\w+)", group: 0, sensitive: true, waitMs: 30000 },
      { type: "web_extract", selector: "button", matchText: "Done", source: "exists", saveAs: "done", sensitive: false, waitMs: 30000 },
      { type: "web_button", selector: "button", matchText: "Check in" },
    ] };
    expect(actionToConfig(actionFromConfig(action))).toEqual(action);
  });

  it("preserves reply capture and derived-value settings", () => {
    const reply = { type: "wait_reply", contact: "bot", afterStep: "request", saveAs: "reply", sensitive: true, maxWaitMs: 30000, maxRetries: 1 };
    const extract = { type: "set_variable", name: "code", value: "${vars.reply}", pattern: "Code: (\\d+)", sensitive: true };
    expect(actionToConfig(actionFromConfig(reply))).toEqual(reply);
    expect(actionToConfig(actionFromConfig(extract))).toEqual(extract);
  });
});
