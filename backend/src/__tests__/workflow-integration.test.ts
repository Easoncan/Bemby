import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  send: vi.fn(), messages: vi.fn(), invoke: vi.fn(), close: vi.fn(), connect: vi.fn(), destroy: vi.fn(),
  opened: vi.fn(), pageRuns: vi.fn(), typed: [] as string[], siteValue: "ABCD123456",
}));

vi.mock("../db/database", () => ({ db: { prepare: () => ({ get: () => undefined, all: () => [], run: () => {} }) } }));
vi.mock("telegram/sessions", () => ({ StringSession: vi.fn() }));
vi.mock("../tg/peerTarget", () => ({ resolvePeerTarget: async (_client: unknown, contact: string) => contact }));
vi.mock("telegram", async (original) => {
  const actual = await original<typeof import("telegram")>();
  return { ...actual, TelegramClient: vi.fn().mockImplementation(() => ({
    connect: mocks.connect, destroy: mocks.destroy, sendMessage: mocks.send,
    getMessages: mocks.messages, invoke: mocks.invoke,
    getPeerId: async (peer: string) => peer === "other_bot" ? "2" : "1",
    getInputEntity: async () => new actual.Api.InputPeerSelf(),
  })) };
});
vi.mock("../jobs/cloudflare", async (original) => {
  const actual = await original<typeof import("../jobs/cloudflare")>();
  const page = {
    screenshot: async () => Buffer.from("fixture image"), locator: () => ({ innerText: async () => "Today checked in" }),
    getByText: () => ({}),
  };
  return { ...actual,
    openWebSession: async (...args: unknown[]) => {
      mocks.opened(...args);
      return { browser: { page, close: mocks.close }, result: { ok: true, finalHost: "fixture.invalid", challenged: false } };
    },
    runWebSteps: async (_page: unknown, steps: any[], _deadline: number, hooks: any) => {
      mocks.pageRuns();
      const logs = [];
      for (const raw of steps) {
        const step = hooks.variables.render(raw);
        if (step.type === "web_extract") hooks.variables.set(step.saveAs, mocks.siteValue, step.sensitive !== false);
        if (step.type === "web_input") mocks.typed.push(step.text);
        logs.push({ type: step.type, label: step.type, outcome: "done" });
      }
      return { logs, ok: true };
    },
  };
});

import { Api } from "telegram";
import { runCustom } from "../jobs/custom";
import type { CustomAction } from "../types";

const open: CustomAction = { type: "web_open", session: "panel", url: "https://fixture.invalid/" };
const run = (actions: CustomAction[], options: { maxRetries?: number; signal?: AbortSignal } = {}) =>
  runCustom(1234, "hash", "session", "bot", { maxWaitMs: 2000, maxRetries: options.maxRetries ?? 1, actions }, options.signal);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.typed.length = 0;
  mocks.siteValue = "ABCD123456";
  mocks.connect.mockResolvedValue(undefined);
  mocks.destroy.mockResolvedValue(undefined);
  mocks.close.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue({ id: 100, date: 1 });
  mocks.invoke.mockResolvedValue({ message: "confirmed" });
  mocks.messages.mockResolvedValue([{ id: 101, out: false, message: "OTP: 654321", replyMarkup: new Api.ReplyInlineMarkup({
    rows: [new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButtonCallback({ text: "Confirm", data: Buffer.from("confirm") })] })],
  }) }]);
});

describe("decoupled workflow wiring", () => {
  it("reads the page, sends through Telegram, presses a fresh reply and returns to the same page", async () => {
    const result = await run([
      open,
      { type: "web_steps", session: "panel", steps: [{ type: "web_extract", selector: "code", source: "text", saveAs: "code" }] },
      { type: "send_contact_message", id: "login_send", contact: "bot", content: "/login ${vars.code}" },
      { type: "click_message_button", afterStep: "login_send", contact: "bot", button: "Confirm", maxWaitMs: 1000, maxRetries: 1 },
      { type: "web_steps", session: "panel", steps: [{ type: "web_input", selector: "input", text: "${vars.code}" }] },
    ]);
    expect(mocks.send).toHaveBeenCalledWith("bot", { message: "/login ABCD123456" });
    expect(mocks.invoke).toHaveBeenCalledWith(expect.objectContaining({ msgId: 101 }));
    expect(mocks.opened).toHaveBeenCalledOnce();
    expect(mocks.typed).toEqual(["ABCD123456"]);
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(JSON.stringify(result)).not.toContain("ABCD123456");
  });

  it("extracts a Telegram reply and fills it into the retained page", async () => {
    await run([
      open,
      { type: "send_contact_message", id: "request_code", contact: "bot", content: "/code" },
      { type: "wait_reply", contact: "bot", afterStep: "request_code", saveAs: "reply", maxWaitMs: 1000 },
      { type: "set_variable", name: "otp", value: "${vars.reply}", pattern: "OTP: (\\d+)" },
      { type: "web_steps", session: "panel", steps: [{ type: "web_input", selector: "input", text: "${vars.otp}" }] },
    ]);
    expect(mocks.typed).toEqual(["654321"]);
  });

  it("skips conditional actions without resolving their absent inputs", async () => {
    const result = await run([
      { type: "set_variable", name: "logged_in", value: "true", sensitive: false },
      { type: "send_contact_message", contact: "bot", content: "${vars.not_defined}", when: { variable: "logged_in", operator: "equals", value: "false" } },
    ]);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.steps[1].skipped).toBe(true);
  });

  it("fails before sending an undefined variable and closes retained pages", async () => {
    await expect(run([open, { type: "send_contact_message", contact: "bot", content: "${vars.missing}" }])).rejects.toThrow("not defined");
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
    expect(mocks.destroy).toHaveBeenCalledOnce();
  });

  it("does not expand placeholders inserted by a page into a message", async () => {
    mocks.siteValue = "{num:6} ${vars.untrusted}";
    await run([open,
      { type: "web_steps", session: "panel", steps: [{ type: "web_extract", source: "text", selector: "code", saveAs: "data" }] },
      { type: "send_contact_message", contact: "bot", content: "${vars.data}" },
    ]);
    expect(mocks.send).toHaveBeenCalledWith("bot", { message: "{num:6} ${vars.untrusted}" });
  });

  it("prevents using another conversation's message anchor", async () => {
    await expect(run([
      { type: "send_contact_message", id: "source", contact: "bot", content: "hello" },
      { type: "click_message_button", contact: "other_bot", afterStep: "source", button: "Confirm", maxWaitMs: 1000, maxRetries: 1 },
    ])).rejects.toThrow("different Telegram conversation");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("closes each attempted browser and discards variables when the chain retries", async () => {
    mocks.send.mockRejectedValue(new Error("offline"));
    await expect(run([open,
      { type: "send_contact_message", contact: "bot", content: "hello" },
    ], { maxRetries: 2 })).rejects.toThrow("offline");
    expect(mocks.opened).toHaveBeenCalledTimes(2);
    expect(mocks.close).toHaveBeenCalledTimes(2);
  });

  it("honors cancellation and closes pages before leaving", async () => {
    const controller = new AbortController();
    mocks.send.mockImplementation(async () => { controller.abort(); return { id: 100, date: 1 }; });
    await expect(run([open,
      { type: "send_contact_message", contact: "bot", content: "hello" },
      { type: "web_steps", session: "panel", steps: [] },
    ], { signal: controller.signal })).rejects.toThrow("cancelled");
    expect(mocks.pageRuns).not.toHaveBeenCalled();
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("starts a fresh variable scope when retrying the entire chain", async () => {
    mocks.send.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ id: 100, date: 1 });
    const result = await run([
      { type: "set_variable", name: "scratch", value: "attempt", sensitive: false, when: { variable: "scratch", operator: "not_exists" } },
      { type: "send_contact_message", contact: "bot", content: "hello" },
    ], { maxRetries: 2 });
    const setters = result.steps.filter((s) => s.actionType === "set_variable");
    expect(setters).toHaveLength(2);
    expect(setters.every((s) => !s.skipped)).toBe(true);
  });
});
