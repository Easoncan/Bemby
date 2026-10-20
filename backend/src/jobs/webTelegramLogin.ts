import type { Page } from "playwright-core";
import { Api, type TelegramClient } from "telegram";
import type { WebStep } from "../types";

type LoginStep = Extract<WebStep, { type: "web_telegram_login" }>;
export type TelegramLoginRequest = {
  contact?: string;
  command: string;
  confirmButton?: string;
  deadline: number;
};
export type TelegramLoginSender = (request: TelegramLoginRequest) => Promise<void>;

/** Extract one explicitly configured login command; never send arbitrary page text. */
export function readTelegramLoginCommand(text: string, prefix = "/login"): string | null {
  if (!/^\/[a-z][a-z0-9_]{0,31}$/i.test(prefix))
    throw new Error("Login command must be a slash followed by a bot command name");
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`(?:^|\\s)${escaped}\\s+([A-Za-z0-9_-]{4,128})(?=\\s|$)`));
  return match ? `${prefix} ${match[1]}` : null;
}

function checkTime(deadline: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Job cancelled");
  if (Date.now() >= deadline) throw new Error("Telegram web login timed out");
}

/** Bound network operations as well as polling; listeners and timers are always removed. */
async function within<T>(work: () => Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  checkTime(deadline, signal);
  let timer: ReturnType<typeof setTimeout>;
  let onAbort: () => void;
  const stop = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Telegram web login timed out")), deadline - Date.now());
    onAbort = () => reject(new Error("Job cancelled"));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([work(), stop]);
  } finally {
    clearTimeout(timer!);
    signal?.removeEventListener("abort", onAbort!);
  }
}

async function pause(deadline: number, signal?: AbortSignal): Promise<void> {
  await within(() => new Promise<void>((resolve) => setTimeout(resolve, Math.min(500, deadline - Date.now()))), deadline, signal);
}

export async function runTelegramWebLogin(
  page: Page,
  step: LoginStep,
  actionDeadline: number,
  send: TelegramLoginSender | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (!step.selector.trim() || !step.successSelector.trim())
    throw new Error("Telegram login needs command and authenticated-page selectors");
  const deadline = Math.min(actionDeadline, Date.now() + (step.waitMs && step.waitMs > 0 ? step.waitMs : 60_000));
  // Validate before clicking anything; the configured bot and command never come from the page.
  const prefix = step.commandPrefix?.trim() || "/login";
  readTelegramLoginCommand("", prefix);
  const visible = async (selector: string) => {
    try {
      return await within(() => page.locator(selector).first().isVisible(), deadline, signal);
    } catch (err: any) {
      // Login completion commonly reloads the document between two polls.
      if (/execution context was destroyed|cannot find context|unable to adopt element/i.test(String(err?.message)))
        return false;
      throw err;
    }
  };
  let started = false;
  for (;;) {
    checkTime(deadline, signal);
    if (await visible(step.successSelector)) return "Web session is already authenticated";
    if (await visible(step.selector)) break;
    if (!started && step.loginSelector?.trim() && await visible(step.loginSelector)) {
      // Use real pointer events without waiting for animation frames, which Xvfb may throttle.
      const box = await within(() => page.locator(step.loginSelector!).first().evaluate((el) => {
        el.scrollIntoView({ block: "center", inline: "center" });
        const r = el.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }), deadline, signal);
      await within(() => page.mouse.click(box.x, box.y), deadline, signal);
      started = true;
    }
    await pause(deadline, signal);
  }

  const text = await within(() => page.locator(step.selector).first().innerText({ timeout: Math.max(1, deadline - Date.now()) }), deadline, signal);
  const command = readTelegramLoginCommand(text, prefix);
  if (!command) throw new Error("The selected element does not contain the configured login command");
  if (!send) throw new Error("This page step has no Telegram account available");
  await within(() => send({ contact: step.contact, command, confirmButton: step.confirmButton, deadline }), deadline, signal);
  for (;;) {
    checkTime(deadline, signal);
    if (await visible(step.successSelector))
      return "Telegram login confirmed; the authenticated page is visible";
    await pause(deadline, signal);
  }
}

/** Only a fresh reply in the chosen bot chat may confirm this login. */
export async function sendTelegramWebLogin(
  client: TelegramClient,
  bot: Api.User,
  request: TelegramLoginRequest,
  signal?: AbortSignal,
): Promise<void> {
  const { deadline } = request;
  const sent = await within(() => client.sendMessage(bot, { message: request.command }), deadline, signal);
  const label = request.confirmButton?.trim();
  if (!label) return;
  for (;;) {
    checkTime(deadline, signal);
    const recent = await within(() => client.getMessages(bot, { limit: 10 }), deadline, signal);
    for (const message of recent) {
      if (message.out || message.id <= sent.id) continue;
      const markup = message.replyMarkup;
      if (!(markup instanceof Api.ReplyInlineMarkup)) continue;
      const button = markup.rows.flatMap((row) => row.buttons).find(
        (b) => b instanceof Api.KeyboardButtonCallback && b.text.trim() === label,
      ) as Api.KeyboardButtonCallback | undefined;
      if (!button) continue;
      const peer = await within(() => client.getInputEntity(bot), deadline, signal);
      try {
        await within(() => client.invoke(new Api.messages.GetBotCallbackAnswer({
          peer, msgId: message.id, data: button.data,
        })), deadline, signal);
      } catch (err: any) {
        // Some bots process the press without answering the callback. The page must still
        // prove login succeeded; a successful send or button press alone is never enough.
        if (!String(err?.message).includes("BOT_RESPONSE_TIMEOUT")) throw err;
      }
      return;
    }
    await pause(deadline, signal);
  }
}
