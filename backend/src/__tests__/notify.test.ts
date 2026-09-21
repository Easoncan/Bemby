// Settings rows the module under test reads. Replaced per test via `settingRows`.
let settingRows: Array<{ key: string; value: string }> = [];

vi.mock("../db/database", () => ({
  db: {
    prepare: vi.fn().mockReturnValue({
      get: vi.fn(),
      all: vi.fn(() => settingRows),
      run: vi.fn(),
    }),
  },
  getDefaultTimezone: vi.fn(() => "Asia/Shanghai"),
}));

const undiciFetch = vi.fn();
vi.mock("undici", () => ({ fetch: (...args: unknown[]) => undiciFetch(...args) }));

const sendMessage = vi.fn();
const destroy = vi.fn();
vi.mock("telegram", () => ({
  TelegramClient: vi.fn().mockImplementation(() => ({
    connect: vi.fn(),
    sendMessage,
    destroy,
  })),
  Logger: vi.fn(),
}));
vi.mock("telegram/extensions/Logger", () => ({ LogLevel: { NONE: 0 } }));
vi.mock("telegram/sessions", () => ({ StringSession: vi.fn() }));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import {
  normaliseNotifyTarget,
  normaliseBotTarget,
  maskBotToken,
  maskFeishuWebhook,
  getNotifyConfig,
  notifyJobEvent,
  recentBotChats,
  sendBotNotify,
  sendFeishuNotify,
  buildFeishuJobCard,
  formatNotifyTime,
  buildFailureMessage,
  buildSuccessMessage,
} from "../jobs/notify";
import { getDefaultTimezone } from "../db/database";
import type { TgAccount } from "../types";

const account = {
  id: 1,
  name: "acct",
  phoneNumber: "+61400000000",
  apiId: 123,
  apiHash: "hash",
  sessionString: "session",
  authStatus: "authenticated",
} as unknown as TgAccount;

/** A Bot API 200 with `ok: true` and the given result. */
function botOk(result: unknown) {
  return { status: 200, json: async () => ({ ok: true, result }) };
}

beforeEach(() => {
  settingRows = [];
  undiciFetch.mockReset();
  sendMessage.mockReset();
  destroy.mockReset();
});

// ---------------------------------------------------------------------------
// normaliseNotifyTarget
// ---------------------------------------------------------------------------

describe("normaliseNotifyTarget", () => {
  it("adds @ to a bare username", () => {
    expect(normaliseNotifyTarget("myuser")).toBe("@myuser");
  });

  it("keeps a single @ on an already-prefixed username", () => {
    expect(normaliseNotifyTarget("@myuser")).toBe("@myuser");
  });

  it("converts a full t.me URL", () => {
    expect(normaliseNotifyTarget("https://t.me/myuser")).toBe("@myuser");
  });

  it("converts a t.me URL without the scheme", () => {
    expect(normaliseNotifyTarget("t.me/myuser")).toBe("@myuser");
  });

  it("converts an http t.me URL", () => {
    expect(normaliseNotifyTarget("http://t.me/myuser")).toBe("@myuser");
  });

  it("trims surrounding whitespace before normalising", () => {
    expect(normaliseNotifyTarget("  @myuser  ")).toBe("@myuser");
  });
});

// ---------------------------------------------------------------------------
// normaliseBotTarget / maskBotToken
// ---------------------------------------------------------------------------

describe("normaliseBotTarget", () => {
  it("passes a numeric chat id through untouched", () => {
    expect(normaliseBotTarget("123456789")).toBe("123456789");
  });

  it("keeps the sign on a group chat id", () => {
    expect(normaliseBotTarget("-1001234567890")).toBe("-1001234567890");
  });

  it("treats anything else as a public @name", () => {
    expect(normaliseBotTarget("mychannel")).toBe("@mychannel");
    expect(normaliseBotTarget("https://t.me/mychannel")).toBe("@mychannel");
  });
});

// Deliberately shorter than a real token's 35-character secret: a fixture shaped like the
// real thing trips GitHub's secret scanner, and none of this depends on the length.
const FAKE_TOKEN = "123456789:test-token-not-a-secret";

describe("maskBotToken", () => {
  it("keeps the public bot id and the last 4 chars", () => {
    expect(maskBotToken(FAKE_TOKEN)).toBe("123456789:****cret");
  });

  it("returns an empty string for no token", () => {
    expect(maskBotToken("")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// getNotifyConfig
// ---------------------------------------------------------------------------

describe("getNotifyConfig", () => {
  it("defaults to notifying on failure only, with nothing configured", () => {
    expect(getNotifyConfig()).toEqual({
      botToken: null,
      botTarget: null,
      username: null,
      events: ["failed"],
      feishuWebhook: null,
      feishuSecret: null,
    });
  });

  it("reads the bot token and normalises the default target", () => {
    settingRows = [
      { key: "notify_bot_token", value: "  123:abc  " },
      { key: "notify_bot_target", value: " t.me/mychannel " },
      { key: "notify_tg_events", value: '["failed","success"]' },
    ];
    expect(getNotifyConfig()).toEqual({
      botToken: "123:abc",
      botTarget: "@mychannel",
      username: null,
      events: ["failed", "success"],
      feishuWebhook: null,
      feishuSecret: null,
    });
  });

  it("reads the Feishu webhook and secret when present", () => {
    settingRows = [
      { key: "notify_feishu_webhook", value: "  https://open.feishu.cn/open-apis/bot/v2/hook/abc  " },
      { key: "notify_feishu_secret", value: "  sec  " },
    ];
    expect(getNotifyConfig().feishuWebhook).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/abc");
    expect(getNotifyConfig().feishuSecret).toBe("sec");
  });
});

// ---------------------------------------------------------------------------
// sendBotNotify / recentBotChats
// ---------------------------------------------------------------------------

describe("sendBotNotify", () => {
  it("posts the target and text to the token's sendMessage endpoint", async () => {
    undiciFetch.mockResolvedValue(botOk({ message_id: 1 }));
    await sendBotNotify("123:abc", "t.me/mychannel", "hello");

    const [url, init] = undiciFetch.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123:abc/sendMessage");
    expect(JSON.parse(init.body)).toMatchObject({
      chat_id: "@mychannel",
      text: "hello",
    });
  });

  it("rejects with the Bot API's own description", async () => {
    undiciFetch.mockResolvedValue({
      status: 400,
      json: async () => ({ ok: false, description: "chat not found" }),
    });
    await expect(sendBotNotify("123:abc", "999", "hello")).rejects.toThrow(
      "chat not found",
    );
  });

  it("rejects when the host cannot reach the Bot API", async () => {
    undiciFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(sendBotNotify("123:abc", "999", "hello")).rejects.toThrow(
      "getaddrinfo ENOTFOUND",
    );
  });
});

describe("recentBotChats", () => {
  it("collects each distinct chat once, whichever update carried it", async () => {
    undiciFetch.mockResolvedValue(
      botOk([
        { update_id: 1, message: { chat: { id: 42, type: "private", first_name: "Sam", username: "sam" } } },
        { update_id: 2, message: { chat: { id: 42, type: "private", first_name: "Sam" } } },
        { update_id: 3, channel_post: { chat: { id: -100, type: "channel", title: "Alerts" } } },
      ]),
    );
    const res = await recentBotChats("123:abc");
    expect(res.ok).toBe(true);
    expect(res.ok && res.result).toEqual([
      { id: 42, type: "private", title: "Sam @sam" },
      { id: -100, type: "channel", title: "Alerts" },
    ]);
  });

  it("reports the failure rather than throwing", async () => {
    undiciFetch.mockResolvedValue({
      status: 401,
      json: async () => ({ ok: false, description: "Unauthorized" }),
    });
    expect(await recentBotChats("bad")).toEqual({ ok: false, error: "Unauthorized" });
  });
});

// ---------------------------------------------------------------------------
// notifyJobEvent -- which sender is used, and when nothing is sent at all
// ---------------------------------------------------------------------------

describe("notifyJobEvent", () => {
  it("sends as the bot when a token is stored, ignoring the account", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
    ];
    undiciFetch.mockResolvedValue(botOk({ message_id: 1 }));

    await notifyJobEvent("failed", "boom", null);

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(undiciFetch.mock.calls[0][1].body)).toMatchObject({
      chat_id: "42",
      text: "boom",
    });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("prefers a per-job target over the global default", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
    ];
    undiciFetch.mockResolvedValue(botOk({ message_id: 1 }));

    await notifyJobEvent("failed", "boom", null, " 777 ");

    expect(JSON.parse(undiciFetch.mock.calls[0][1].body)).toMatchObject({
      chat_id: "777",
    });
  });

  it("sends nothing when the event is not one of the configured ones", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
      { key: "notify_tg_events", value: '["failed"]' },
    ];

    await notifyJobEvent("success", "done", account);

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing when a token is stored but no target is", async () => {
    settingRows = [{ key: "notify_bot_token", value: "123:abc" }];

    await notifyJobEvent("failed", "boom", account);

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("swallows a bot send failure so the run is not affected", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
    ];
    undiciFetch.mockRejectedValue(new Error("network down"));

    await expect(notifyJobEvent("failed", "boom", null)).resolves.toBeUndefined();
  });

  it("falls back to the account session when no bot token is stored", async () => {
    settingRows = [{ key: "notify_tg_username", value: "someone" }];

    await notifyJobEvent("failed", "boom", account);

    expect(undiciFetch).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith("@someone", { message: "boom" });
  });

  it("warns that the account sender is deprecated whenever it is used", async () => {
    settingRows = [{ key: "notify_tg_username", value: "someone" }];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyJobEvent("failed", "boom", account);

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
    warn.mockRestore();
  });

  it("does not warn about deprecation when the bot sends", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
    ];
    undiciFetch.mockResolvedValue(botOk({ message_id: 1 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await notifyJobEvent("failed", "boom", account);

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("still sends a failure to Saved Messages when the fallback has no target", async () => {
    await notifyJobEvent("failed", "boom", account);
    expect(sendMessage).toHaveBeenCalledWith("me", { message: "boom" });
  });

  it("does not send a success through the fallback with no target configured", async () => {
    settingRows = [{ key: "notify_tg_events", value: '["success"]' }];

    await notifyJobEvent("success", "done", account);

    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("sends nothing through the fallback when the account has no session", async () => {
    settingRows = [{ key: "notify_tg_username", value: "someone" }];

    await notifyJobEvent("failed", "boom", { ...account, sessionString: null });

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// buildFailureMessage
// ---------------------------------------------------------------------------

describe("buildFailureMessage", () => {
  it("includes the job name, type, and error message", () => {
    const msg = buildFailureMessage("Daily Checkin", "checkin", "Timeout");
    expect(msg).toContain("Daily Checkin");
    expect(msg).toContain("checkin");
    expect(msg).toContain("Timeout");
  });

  it("has the correct format", () => {
    const msg = buildFailureMessage("Job A", "custom", "Something went wrong");
    expect(msg).toBe(
      "❌ Bemby job failed\n\nJob: Job A\nType: custom\nError: Something went wrong",
    );
  });
});

// ---------------------------------------------------------------------------
// buildSuccessMessage
// ---------------------------------------------------------------------------

describe("buildSuccessMessage", () => {
  it("includes the job name and type", () => {
    const msg = buildSuccessMessage("Daily Checkin", "checkin");
    expect(msg).toContain("Daily Checkin");
    expect(msg).toContain("checkin");
  });

  it("has the correct format", () => {
    const msg = buildSuccessMessage("Job A", "custom");
    expect(msg).toBe("✅ Bemby job succeeded\n\nJob: Job A\nType: custom");
  });
});

// ---------------------------------------------------------------------------
// maskFeishuWebhook
// ---------------------------------------------------------------------------

describe("maskFeishuWebhook", () => {
  it("keeps the host and masks only the hook id", () => {
    expect(
      maskFeishuWebhook(
        "https://open.feishu.cn/open-apis/bot/v2/hook/cb4674f3-200b-4b75-afba-578b031c3f94",
      ),
    ).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/****");
  });

  it("falls back to a generic mask for an unparseable URL", () => {
    expect(maskFeishuWebhook("not a url")).toBe("https://open.feishu.cn/.../hook/****");
  });
});

// ---------------------------------------------------------------------------
// sendFeishuNotify
// ---------------------------------------------------------------------------

/** A Feishu 200 with code 0. */
function feishuOk() {
  return {
    status: 200,
    json: async () => ({ code: 0, msg: "success", data: null }),
  };
}

describe("sendFeishuNotify", () => {
  it("posts a text message without a signature when no secret is set", async () => {
    undiciFetch.mockResolvedValue(feishuOk());

    await sendFeishuNotify("https://open.feishu.cn/open-apis/bot/v2/hook/abc", null, "hello");

    const [url, init] = undiciFetch.mock.calls[0];
    expect(url).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/abc");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ msg_type: "text", content: { text: "hello" } });
    expect(body.timestamp).toBeUndefined();
    expect(body.sign).toBeUndefined();
  });

  it("adds a timestamp and a valid HMAC-SHA256 signature when a secret is set", async () => {
    undiciFetch.mockResolvedValue(feishuOk());

    await sendFeishuNotify(
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
      "sec",
      "hello",
    );

    const body = JSON.parse(undiciFetch.mock.calls[0][1].body);
    expect(body.timestamp).toBeDefined();
    expect(body.sign).toBeDefined();
    // Recompute the signature the way Feishu does and confirm it matches
    const expected = createHmac("sha256", `${body.timestamp}\nsec`)
      .update("")
      .digest("base64");
    expect(body.sign).toBe(expected);
  });

  it("rejects when Feishu returns a non-zero code", async () => {
    undiciFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ code: 19021, msg: "sign match fail" }),
    });
    await expect(
      sendFeishuNotify("https://open.feishu.cn/open-apis/bot/v2/hook/abc", "sec", "hi"),
    ).rejects.toThrow("sign match fail");
  });

  it("rejects when the request cannot reach Feishu", async () => {
    undiciFetch.mockRejectedValue(new Error("getaddrinfo ENOTFOUND"));
    await expect(
      sendFeishuNotify("https://open.feishu.cn/open-apis/bot/v2/hook/abc", null, "hi"),
    ).rejects.toThrow("getaddrinfo ENOTFOUND");
  });
});

// ---------------------------------------------------------------------------
// buildFeishuJobCard / formatNotifyTime
// ---------------------------------------------------------------------------

describe("formatNotifyTime", () => {
  it("formats the instance timezone with a UTC offset suffix", () => {
    // 2026-09-20T16:05:07Z is 2026-09-21 00:05:07 in Asia/Shanghai (UTC+8)
    const out = formatNotifyTime(new Date("2026-09-20T16:05:07Z"));
    expect(out).toBe("2026-09-21 00:05:07 (UTC+8)");
  });

  it("falls back to the ISO string for an unknown zone", () => {
    vi.mocked(getDefaultTimezone).mockReturnValueOnce("Not/AZone");
    const date = new Date("2026-09-20T16:05:07Z");
    expect(formatNotifyTime(date)).toBe(date.toISOString());
  });
});

describe("buildFeishuJobCard", () => {
  it("renders a green success card with the Chinese title and compact one-per-line rows", () => {
    const body = buildFeishuJobCard("success", { jobName: "Daily", jobType: "checkin" });
    expect(body.msg_type).toBe("interactive");
    const card = body.card as any;
    expect(card.header).toEqual({
      title: { tag: "plain_text", content: "🤖 Bemby 自动任务 · 执行成功" },
      template: "green",
    });
    // All four rows live in a single text element, separated only by newlines (no element gap).
    expect(card.elements).toHaveLength(1);
    const lines = card.elements[0].text.content.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines[0]).toBe("**任务**：Daily");
    expect(lines[1]).toBe("**类型**：签到任务");
    expect(lines[2]).toMatch(/^\*\*时间\*\*：\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    expect(lines[3]).toBe("**结果**：✅ 成功");
  });

  it("renders a red failure card with the error detail after a divider", () => {
    const body = buildFeishuJobCard("failed", {
      jobName: "Daily",
      jobType: "custom",
      detail: "connect timed out",
    });
    const card = body.card as any;
    expect(card.header).toEqual({
      title: { tag: "plain_text", content: "🤖 Bemby 自动任务 · 执行失败" },
      template: "red",
    });
    expect(card.elements[0].text.content.split("\n")[3]).toBe("**结果**：❌ 失败");
    expect(card.elements[1]).toEqual({ tag: "hr" });
    expect(card.elements[2].text.content).toContain("**详情**");
    expect(card.elements[2].text.content).toContain("connect timed out");
  });

  it("passes an unknown job type through as-is", () => {
    const body = buildFeishuJobCard("success", { jobName: "X", jobType: "mystery" });
    expect((body.card as any).elements[0].text.content).toContain("**类型**：mystery");
  });
});

// ---------------------------------------------------------------------------
// notifyJobEvent -- Feishu as a second, independent channel
// ---------------------------------------------------------------------------

describe("notifyJobEvent + Feishu", () => {
  it("sends to both Telegram and Feishu when both are configured", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
      { key: "notify_feishu_webhook", value: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" },
      { key: "notify_feishu_secret", value: "sec" },
    ];
    // The bot and Feishu calls hit different hosts; respond to each with its own shape.
    undiciFetch.mockImplementation((url: string) =>
      url.includes("telegram.org") ? botOk({ message_id: 1 }) : feishuOk(),
    );

    await notifyJobEvent("failed", "boom", null);

    expect(undiciFetch).toHaveBeenCalledTimes(2);
    const feishuCall = undiciFetch.mock.calls[1];
    expect(feishuCall[0]).toBe("https://open.feishu.cn/open-apis/bot/v2/hook/abc");
    const feishuBody = JSON.parse(feishuCall[1].body);
    expect(feishuBody.msg_type).toBe("text");
    expect(feishuBody.content.text).toBe("boom");
    expect(feishuBody.sign).toBeDefined();
  });

  it("posts an interactive card to Feishu when structured meta is given", async () => {
    settingRows = [
      { key: "notify_feishu_webhook", value: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" },
    ];
    undiciFetch.mockResolvedValue(feishuOk());

    await notifyJobEvent("failed", "boom", null, null, {
      jobName: "Daily Checkin",
      jobType: "checkin",
      detail: "connect timed out",
    });

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    const body = JSON.parse(undiciFetch.mock.calls[0][1].body);
    expect(body.msg_type).toBe("interactive");
    const card = body.card as any;
    expect(card.header.title.content).toBe("🤖 Bemby 自动任务 · 执行失败");
    expect(card.header.template).toBe("red");
    const lines = card.elements[0].text.content.split("\n");
    expect(lines[0]).toBe("**任务**：Daily Checkin");
    expect(lines[1]).toBe("**类型**：签到任务");
    expect(lines[3]).toBe("**结果**：❌ 失败");
    expect(card.elements[2].text.content).toContain("connect timed out");
  });

  it("sends only to Feishu when Telegram is not configured", async () => {
    settingRows = [
      { key: "notify_feishu_webhook", value: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" },
    ];
    undiciFetch.mockResolvedValue(feishuOk());

    await notifyJobEvent("failed", "boom", account);

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch.mock.calls[0][0]).toBe(
      "https://open.feishu.cn/open-apis/bot/v2/hook/abc",
    );
  });

  it("does not send to Feishu when its webhook is unset", async () => {
    settingRows = [{ key: "notify_bot_token", value: "123:abc" }, { key: "notify_bot_target", value: "42" }];
    undiciFetch.mockResolvedValue(botOk({ message_id: 1 }));

    await notifyJobEvent("failed", "boom", null);

    expect(undiciFetch).toHaveBeenCalledTimes(1);
    expect(undiciFetch.mock.calls[0][0]).toBe("https://api.telegram.org/bot123:abc/sendMessage");
  });

  it("swallows a Feishu failure so the Telegram send and the run are unaffected", async () => {
    settingRows = [
      { key: "notify_bot_token", value: "123:abc" },
      { key: "notify_bot_target", value: "42" },
      { key: "notify_feishu_webhook", value: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" },
    ];
    // Bot call succeeds; Feishu call rejects.
    undiciFetch
      .mockResolvedValueOnce(botOk({ message_id: 1 }))
      .mockRejectedValueOnce(new Error("network down"));

    await expect(notifyJobEvent("failed", "boom", null)).resolves.toBeUndefined();
    expect(undiciFetch).toHaveBeenCalledTimes(2);
  });
});
