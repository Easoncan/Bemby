import { TelegramClient, Logger } from "telegram";
import { LogLevel } from "telegram/extensions/Logger";
import { StringSession } from "telegram/sessions";
import { fetch as undiciFetch } from "undici";
import { createHmac } from "node:crypto";
import type { TgAccount } from "../types";
import { db, getDefaultTimezone } from "../db/database";

export type NotifyEvent = "success" | "failed";

export type NotifyConfig = {
  /** Bot API token from BotFather. The preferred sender: needs no account session. */
  botToken: string | null;
  /** Chat the bot sends to when a job names no target of its own. */
  botTarget: string | null;
  /**
   * Target for the account-session sender, used only when no bot token is set.
   * @deprecated The account-session sender is going away; use botToken + botTarget.
   */
  username: string | null;
  events: string[];
  /** Feishu custom bot webhook URL (open.feishu.cn/open-apis/bot/v2/hook/...). */
  feishuWebhook: string | null;
  /** Feishu custom bot signing secret; only needed when the bot enables signature verification. */
  feishuSecret: string | null;
};

export const NOTIFY_BOT_TOKEN_KEY = "notify_bot_token";
export const NOTIFY_BOT_TARGET_KEY = "notify_bot_target";
export const NOTIFY_FEISHU_WEBHOOK_KEY = "notify_feishu_webhook";
export const NOTIFY_FEISHU_SECRET_KEY = "notify_feishu_secret";

const BOT_API = "https://api.telegram.org";

/** Normalises username / @username / https://t.me/username to a bare @username peer string. */
export function normaliseNotifyTarget(raw: string): string {
  const s = raw.trim();
  // t.me URL
  const tme = s.match(/(?:https?:\/\/)?t\.me\/([A-Za-z0-9_]{3,})/);
  if (tme) return `@${tme[1]}`;
  // Strip leading @, re-add to normalise
  const stripped = s.replace(/^@/, "");
  return `@${stripped}`;
}

/**
 * Normalises a Bot API chat target. A bot cannot look a user up by @username -- only a
 * numeric chat id reaches a person, and @name only reaches a public channel or group -- so
 * a numeric id is passed through untouched and everything else is treated as a @name.
 */
export function normaliseBotTarget(raw: string): string {
  const s = raw.trim();
  if (/^-?\d+$/.test(s)) return s;
  return normaliseNotifyTarget(s);
}

/** True when the target is a numeric chat id rather than a public @name. */
export function isChatId(target: string): boolean {
  return /^-?\d+$/.test(target.trim());
}

export function getNotifyConfig(): NotifyConfig {
  const rows = db
    .prepare(
      `SELECT key, value FROM settings
       WHERE key IN ('notify_tg_username', 'notify_tg_events', 'notify_bot_token', 'notify_bot_target',
                     '${NOTIFY_FEISHU_WEBHOOK_KEY}', '${NOTIFY_FEISHU_SECRET_KEY}')`,
    )
    .all() as { key: string; value: string }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let events: string[] = ["failed"];
  try {
    if (map.notify_tg_events) events = JSON.parse(map.notify_tg_events);
  } catch {
    /* ignore */
  }
  const raw = map.notify_tg_username?.trim();
  const botTarget = map[NOTIFY_BOT_TARGET_KEY]?.trim();
  const feishuWebhook = map[NOTIFY_FEISHU_WEBHOOK_KEY]?.trim() || null;
  const feishuSecret = map[NOTIFY_FEISHU_SECRET_KEY]?.trim() || null;
  return {
    botToken: map[NOTIFY_BOT_TOKEN_KEY]?.trim() || null,
    botTarget: botTarget ? normaliseBotTarget(botTarget) : null,
    username: raw ? normaliseNotifyTarget(raw) : null,
    events,
    feishuWebhook,
    feishuSecret,
  };
}

/** Masks a Feishu webhook down to its host + a trailing ****, so the operator can tell it
 *  is set without the hook id (which is effectively a password) leaking into the response. */
export function maskFeishuWebhook(url: string): string {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/");
    if (parts.length) parts[parts.length - 1] = "****";
    return `${u.origin}${parts.join("/")}`;
  } catch {
    return "https://open.feishu.cn/.../hook/****";
  }
}

/** Returns the last 4 chars of a bot token behind its public numeric id: 12345678:****wXyZ. */
export function maskBotToken(token: string): string {
  if (!token) return "";
  const id = token.split(":")[0] ?? "";
  const tail = token.length > 4 ? token.slice(-4) : "";
  return `${id}:****${tail}`;
}

type BotApiResult<T> = { ok: true; result: T } | { ok: false; error: string };

/** One Bot API call. Never throws: a transport failure comes back as ok:false. */
async function botApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<BotApiResult<T>> {
  try {
    const res = await undiciFetch(`${BOT_API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(15000),
    });
    const json = (await res.json()) as {
      ok?: boolean;
      result?: T;
      description?: string;
    };
    if (!json?.ok) {
      return { ok: false, error: json?.description ?? `HTTP ${res.status}` };
    }
    return { ok: true, result: json.result as T };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type BotInfo = { id: number; username?: string; first_name?: string };

/** getMe -- confirms the token is live and names the bot it belongs to. */
export function getBotInfo(token: string): Promise<BotApiResult<BotInfo>> {
  return botApi<BotInfo>(token, "getMe");
}

export type BotChat = {
  id: number;
  type: string;
  title: string;
};

/**
 * Chats the bot has heard from recently, via getUpdates. This is how an operator finds the
 * numeric chat id to notify: message the bot, then read the id back off this list. Only
 * works while no webhook is set and only covers updates Telegram still holds (~24h).
 */
export async function recentBotChats(token: string): Promise<BotApiResult<BotChat[]>> {
  const res = await botApi<Array<Record<string, unknown>>>(token, "getUpdates", {
    limit: 100,
    allowed_updates: [],
  });
  if (!res.ok) return res;

  const chats = new Map<number, BotChat>();
  for (const update of res.result) {
    // Every update that carries a chat -- message, edited_message, channel_post,
    // my_chat_member -- holds it under the same `chat` key one level down.
    for (const value of Object.values(update)) {
      const chat = (value as { chat?: RawChat } | null)?.chat;
      if (!chat || typeof chat.id !== "number" || chats.has(chat.id)) continue;
      chats.set(chat.id, { id: chat.id, type: chat.type, title: chatTitle(chat) });
    }
  }
  return { ok: true, result: [...chats.values()] };
}

type RawChat = {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
};

function chatTitle(chat: RawChat): string {
  const name = [chat.first_name, chat.username ? `@${chat.username}` : null]
    .filter(Boolean)
    .join(" ");
  return chat.title || name || String(chat.id);
}

/** Sends a message as the bot. Rejects with the Bot API's own description on failure. */
export async function sendBotNotify(
  token: string,
  target: string,
  message: string,
): Promise<void> {
  const res = await botApi(token, "sendMessage", {
    chat_id: normaliseBotTarget(target),
    text: message,
    disable_web_page_preview: true,
  });
  if (!res.ok) throw new Error(res.error);
}

/**
 * Signs a Feishu custom-bot request when a secret is set. Feishu concatenates the current
 * second-level timestamp and the secret with a newline, then expects base64(HMAC-SHA256 of
 * that string, keyed by the same string) as `sign`. With no secret the fields are omitted and
 * the bot must have signature verification turned off.
 */
function feishuSignature(secret: string): { timestamp: string; sign: string } {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const stringToSign = `${timestamp}\n${secret}`;
  const sign = createHmac("sha256", stringToSign).update("").digest("base64");
  return { timestamp, sign };
}

/**
 * Posts a payload to a Feishu custom bot webhook. Throws with Feishu's own error text
 * on a non-zero `code` or a transport failure, so callers can catch and report it.
 * Feishu always answers with HTTP 200 and signals outcome via `code` in the body: 0
 * means success, anything else is an error. A body that is not JSON (proxy error
 * page, etc.) is treated as failure rather than a silent success.
 */
async function postFeishu(
  webhook: string,
  secret: string | null,
  body: Record<string, unknown>,
): Promise<void> {
  const payload: Record<string, unknown> = { ...body };
  if (secret) {
    const { timestamp, sign } = feishuSignature(secret);
    payload.timestamp = timestamp;
    payload.sign = sign;
  }
  try {
    const res = await undiciFetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });
    let json: { code?: number; msg?: string; StatusMessage?: string };
    try {
      json = (await res.json()) as typeof json;
    } catch {
      json = {};
    }
    if (json.code === undefined) {
      throw new Error(`Feishu returned no result (HTTP ${res.status})`);
    }
    if (json.code !== 0) {
      throw new Error(json.msg || json.StatusMessage || `Feishu error ${json.code}`);
    }
  } catch (err: unknown) {
    throw new Error(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Posts a text message to a Feishu custom bot webhook.
 */
export async function sendFeishuNotify(
  webhook: string,
  secret: string | null,
  message: string,
): Promise<void> {
  await postFeishu(webhook, secret, {
    msg_type: "text",
    content: { text: message },
  });
}

/** Structured info the Feishu card renders from. The Telegram text keeps its own
 *  plain format; only the Feishu channel upgrades to an interactive card. */
export type FeishuJobMeta = {
  jobName: string;
  jobType: string;
  /** Failure detail (the error text) shown in the card body; omitted when absent. */
  detail?: string | null;
};

const FEISHU_JOB_TYPE_LABELS: Record<string, string> = {
  checkin: "签到任务",
  embywatch: "Emby 观看",
  custom: "自定义任务",
  autoreg: "自动注册",
};

/** Feishu icon + title prefix shared by every card, success or failure alike. */
const FEISHU_CARD_TITLE_OK = "🤖 Bemby 自动任务 · 执行成功";
const FEISHU_CARD_TITLE_FAILED = "🤖 Bemby 自动任务 · 执行失败";

/**
 * Formats the current time in the instance's default_timezone, e.g.
 * `2026-09-21 00:05:07 (UTC+8)`. Falls back to the ISO string if the zone is unknown.
 */
export function formatNotifyTime(now: Date = new Date()): string {
  const tz = getDefaultTimezone();
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "shortOffset",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const offset = get("timeZoneName").replace(/^GMT/, "UTC");
    const base = `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
    return offset && offset !== "UTC" ? `${base} (${offset})` : base;
  } catch {
    return now.toISOString();
  }
}

/** One card row: the label and its value share a line, separated by a full-width colon. */
function feishuRow(label: string, value: string): string {
  return `**${label}**：${value}`;
}

/**
 * Builds the interactive-card payload a finished job renders as on Feishu: a coloured
 * header (green success / red failure) with a Chinese title, then one compact block of
 * rows -- job, type, time, result, one per line, separated only by newlines so Feishu
 * adds no gap between them. On failures a divider and the error detail follow (its label
 * on one line, the text on the next).
 */
export function buildFeishuJobCard(
  event: NotifyEvent,
  meta: FeishuJobMeta,
): Record<string, unknown> {
  const ok = event === "success";
  const rows = [
    feishuRow("任务", meta.jobName),
    feishuRow("类型", FEISHU_JOB_TYPE_LABELS[meta.jobType] ?? meta.jobType),
    feishuRow("时间", formatNotifyTime()),
    feishuRow("结果", ok ? "✅ 成功" : "❌ 失败"),
  ];
  const elements: Record<string, unknown>[] = [
    { tag: "div", text: { tag: "lark_md", content: rows.join("\n") } },
  ];
  if (meta.detail) {
    elements.push({ tag: "hr" });
    elements.push({
      tag: "div",
      text: { tag: "lark_md", content: `**详情**\n${meta.detail}` },
    });
  }
  return {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: ok ? FEISHU_CARD_TITLE_OK : FEISHU_CARD_TITLE_FAILED },
        template: ok ? "green" : "red",
      },
      elements,
    },
  };
}

/** Posts a pre-built payload -- e.g. the card from {@link buildFeishuJobCard}. */
export async function sendFeishuCard(
  webhook: string,
  secret: string | null,
  body: Record<string, unknown>,
): Promise<void> {
  await postFeishu(webhook, secret, body);
}

/**
 * Sends a notification via the given account's session.
 * target defaults to 'me' (Saved Messages).
 * Fire-and-forget -- callers should .catch() any rejection.
 *
 * @deprecated Superseded by {@link sendBotNotify}, and due for removal in a future
 * release. Sending as the account spins up a full MTProto client per notification and
 * only works when that account is authenticated; a bot token has neither limitation.
 */
export async function sendTgNotify(
  account: TgAccount,
  message: string,
  target = "me",
): Promise<void> {
  if (!account.sessionString || !account.apiId || !account.apiHash) return;

  const client = new TelegramClient(
    new StringSession(account.sessionString),
    account.apiId,
    account.apiHash,
    {
      connectionRetries: 3,
      autoReconnect: false,
      baseLogger: new Logger(LogLevel.NONE),
    },
  );

  try {
    await client.connect();
    await client.sendMessage(target, { message });
  } finally {
    // destroy, not disconnect -- only destroy stops the GramJS ping loop (issue #14)
    try {
      await client.destroy();
    } catch {
      /* ignore */
    }
  }
}

/**
 * The one place a finished job's notification is decided and sent. The bot is preferred
 * because it needs no account session, so a job whose account is unauthenticated -- or a
 * job type that has no account at all -- still notifies. Without a bot token this falls
 * back to sending from the job's own account, which is what installs did before tokens.
 * That fallback is deprecated and will be removed, so it warns each time it is used.
 *
 * `target` is the per-job override; the global default applies when it is absent.
 * Never throws: a failed notification must not fail the run that triggered it.
 */
export async function notifyJobEvent(
  event: NotifyEvent,
  message: string,
  account?: TgAccount | null,
  target?: string | null,
  feishuMeta?: FeishuJobMeta | null,
): Promise<void> {
  const cfg = getNotifyConfig();
  if (!cfg.events.includes(event)) return;

  // Telegram channel: the bot is preferred; the account session is a deprecated fallback.
  if (cfg.botToken) {
    const chat = target?.trim() || cfg.botTarget;
    if (chat) {
      await sendBotNotify(cfg.botToken, chat, message).catch((e) =>
        console.warn("[notify] bot notification failed:", e),
      );
    }
  } else if (account?.sessionString) {
    const legacyTarget = target?.trim() || cfg.username;
    if (legacyTarget || event === "failed") {
      console.warn(
        "[notify] sending as the account is deprecated and will be removed in a future release -- set a notification bot token in Settings",
      );
      await sendTgNotify(account, message, legacyTarget ?? "me").catch((e) =>
        console.warn("[notify] TG notification failed:", e),
      );
    }
  }

  // Feishu channel: an independent second destination. Both platforms get the same push when
  // each is configured; a Feishu failure must not affect the run or the Telegram send.
  // With structured meta the channel renders an interactive card; without it the
  // plain text message is posted as-is.
  if (cfg.feishuWebhook) {
    const send = feishuMeta
      ? sendFeishuCard(cfg.feishuWebhook, cfg.feishuSecret, buildFeishuJobCard(event, feishuMeta))
      : sendFeishuNotify(cfg.feishuWebhook, cfg.feishuSecret, message);
    await send.catch((e) =>
      console.warn("[notify] feishu notification failed:", e),
    );
  }
}

export function buildFailureMessage(
  jobName: string,
  jobType: string,
  errorMessage: string,
): string {
  return [
    "❌ Bemby job failed",
    "",
    `Job: ${jobName}`,
    `Type: ${jobType}`,
    `Error: ${errorMessage}`,
  ].join("\n");
}

export function buildSuccessMessage(jobName: string, jobType: string): string {
  return [
    "✅ Bemby job succeeded",
    "",
    `Job: ${jobName}`,
    `Type: ${jobType}`,
  ].join("\n");
}
