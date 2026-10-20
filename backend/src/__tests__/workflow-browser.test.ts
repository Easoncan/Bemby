import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { chromium, type Browser } from "playwright-core";
vi.mock("../db/database", () => ({ db: { prepare: () => ({ get: () => ({ value: JSON.stringify({ inAppStepMs: 0, inAppSettleMs: 0 }) }), all: () => [], run: () => {} }) } }));
import { chromiumExecutable } from "../jobs/cfBrowser";
import { runWebSteps } from "../jobs/cloudflare";
import { WorkflowContext } from "../jobs/workflow/context";

const executablePath = process.env.BEMBY_TEST_CHROMIUM_PATH || chromiumExecutable("free");

describe.skipIf(!executablePath)("workflow operations in a real browser", () => {
  let browser: Browser;
  beforeAll(async () => { browser = await chromium.launch({ executablePath, headless: true }); }, 30_000);
  afterAll(async () => { await browser?.close(); });

  it("extracts a value, uses it in a later page step, and masks sensitive fields in captures", async () => {
    const page = await browser.newPage();
    await page.setContent('<code id="command">ABCD123456</code><input id="otp"><a id="link" href="/next">next</a>');
    const ctx = new WorkflowContext(Date.now() + 10_000);
    const shots = vi.spyOn(page, "screenshot");
    const result = await runWebSteps(page, [
      { type: "web_extract", selector: "#command", source: "text", saveAs: "code" },
      { type: "web_input", selector: "#otp", text: "${vars.code}" },
      { type: "web_extract", selector: "#link", source: "attribute", attribute: "href", saveAs: "url", sensitive: false },
    ], ctx.deadline, { variables: ctx });
    expect(result.ok).toBe(true);
    expect(await page.locator("#otp").inputValue()).toBe("ABCD123456");
    expect(ctx.render("${vars.url}")).toBe("/next");
    expect(JSON.stringify(result)).not.toContain("ABCD123456");
    expect(shots.mock.calls.every(([options]) => (options?.mask?.length ?? 0) > 0)).toBe(true);
    await page.close();
  }, 15_000);

  it("filters matching text so a generic selector presses the intended button", async () => {
    const page = await browser.newPage();
    await page.setContent('<button onclick="document.body.dataset.clicked=\'wrong\'">Buy</button><button onclick="document.body.dataset.clicked=\'checkin\'">Check in</button>');
    const ctx = new WorkflowContext(Date.now() + 10_000);
    const result = await runWebSteps(page, [
      { type: "web_button", selector: "button", matchText: "Check in" },
      { type: "web_extract", selector: "button", matchText: "Done", source: "exists", saveAs: "done" },
    ], ctx.deadline, { variables: ctx });
    expect(result.ok).toBe(true);
    expect(await page.locator("body").getAttribute("data-clicked")).toBe("checkin");
    expect(ctx.render("${vars.done}")).toBe("false");
    await page.close();
  }, 15_000);

  it("waits for the intended text after an asynchronous page update", async () => {
    const page = await browser.newPage();
    await page.setContent('<button onclick="setTimeout(()=>this.textContent=\'Done\',100)">Check in</button>');
    const ctx = new WorkflowContext(Date.now() + 10_000);
    const result = await runWebSteps(page, [
      { type: "web_button", selector: "button", matchText: "Check in" },
      { type: "web_wait_element", selector: "button", matchText: "Done", waitMs: 2000 },
    ], ctx.deadline, { variables: ctx });
    expect(result.ok).toBe(true);
    expect(await page.locator("button").innerText()).toBe("Done");
    await page.close();
  }, 15_000);
});
