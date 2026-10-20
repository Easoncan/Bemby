import { describe, expect, it, vi } from "vitest";
import { Api, type TelegramClient } from "telegram";
import type { Page } from "playwright-core";
import { readTelegramLoginCommand, runTelegramWebLogin, sendTelegramWebLogin } from "../jobs/webTelegramLogin";

const step = {
  type: "web_telegram_login" as const,
  selector: ".web-login-command code",
  loginSelector: ".web-login-telegram-button",
  successSelector: ".web-account-header",
  contact: "zzmeb_bot",
  confirmButton: "确认登录",
};

function fixture(authenticated = false) {
  let commandVisible = false;
  const click = vi.fn(async () => { commandVisible = true; });
  const page = { mouse: { click }, locator: (selector: string) => ({ first: () => ({
    isVisible: async () => selector === step.successSelector ? authenticated
      : selector === step.selector ? commandVisible : true,
    evaluate: async () => ({ x: 100, y: 100 }),
    innerText: async () => "/login ABCD123456",
  }) }) } as unknown as Page;
  return { page, click, authenticate: () => { authenticated = true; } };
}

describe("Telegram web login", () => {
  it("sends the command, confirms through Telegram, and waits for the authenticated page", async () => {
    const f = fixture();
    const send = vi.fn(async () => { f.authenticate(); });
    const result = await runTelegramWebLogin(f.page, step, Date.now() + 3000, send);
    expect(f.click).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      command: "/login ABCD123456", contact: "zzmeb_bot", confirmButton: "确认登录",
    }));
    expect(result).toContain("authenticated page is visible");
    expect(result).not.toContain("ABCD123456");
  });

  it("reuses an authenticated page without sending another login command", async () => {
    const f = fixture(true);
    const send = vi.fn();
    expect(await runTelegramWebLogin(f.page, step, Date.now() + 1000, send)).toContain("already authenticated");
    expect(send).not.toHaveBeenCalled();
    expect(f.click).not.toHaveBeenCalled();
  });

  it("does not report success when the bot accepted the message but the page never logged in", async () => {
    const f = fixture();
    await expect(runTelegramWebLogin(f.page, step, Date.now() + 550, async () => {})).rejects.toThrow("timed out");
  });

  it("does not send after cancellation", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    const send = vi.fn();
    await expect(runTelegramWebLogin(f.page, step, Date.now() + 1000, send, controller.signal)).rejects.toThrow("cancelled");
    expect(send).not.toHaveBeenCalled();
  });

  it("only extracts the configured command and a single code", () => {
    expect(readTelegramLoginCommand("copy /login ABCD123456\nother text")).toBe("/login ABCD123456");
    expect(readTelegramLoginCommand("/start ABCD123456")).toBeNull();
    expect(readTelegramLoginCommand("/login ABCD123456" , "/auth")).toBeNull();
    expect(readTelegramLoginCommand("/auth abcd-1234", "/auth")).toBe("/auth abcd-1234");
    expect(readTelegramLoginCommand("/login BAD\"CODE")).toBeNull();
    expect(() => readTelegramLoginCommand("", "/login|/delete")).toThrow("command name");
  });
});

describe("Telegram confirmation", () => {
  it("clicks only the exact button on a new incoming reply in the configured bot chat", async () => {
    const markup = (label: string) => new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardButtonRow({
      buttons: [new Api.KeyboardButtonCallback({ text: label, data: Buffer.from(label) })],
    })] });
    const bot = new Api.User({ id: BigInt(123) as any, bot: true });
    const invoke = vi.fn(async () => ({}));
    const client = {
      sendMessage: vi.fn(async () => ({ id: 100 })),
      getMessages: vi.fn(async () => [
        { id: 99, out: false, replyMarkup: markup("确认登录") },
        { id: 101, out: true, replyMarkup: markup("确认登录") },
        { id: 102, out: false, replyMarkup: markup("取消") },
        { id: 103, out: false, replyMarkup: markup("确认登录") },
      ]),
      getInputEntity: vi.fn(async () => new Api.InputPeerSelf()),
      invoke,
    } as unknown as TelegramClient;
    await sendTelegramWebLogin(client, bot, { command: "/login ABCD123456", confirmButton: "确认登录", deadline: Date.now() + 1000 });
    expect(client.sendMessage).toHaveBeenCalledWith(bot, { message: "/login ABCD123456" });
    expect(client.getMessages).toHaveBeenCalledWith(bot, { limit: 10 });
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ msgId: 103, data: Buffer.from("确认登录") }));
  });
});
