import { Api, type TelegramClient } from "telegram";
import { checkDeadline, pollDelay, within, type MessageAnchor } from "./context";

type ReplyOptions = {
  button?: string;
  match?: "exact" | "contains";
  successContains?: string;
  failContains?: string;
};

/** A peer-scoped history scan covers replies that arrived before the next step started. */
export async function waitWorkflowReply(
  client: TelegramClient,
  peer: Api.TypeEntityLike,
  anchor: MessageAnchor,
  options: ReplyOptions,
  deadline: number,
  signal?: AbortSignal,
): Promise<Api.Message> {
  for (;;) {
    checkDeadline(deadline, signal);
    const recent = await within(() => client.getMessages(peer, { limit: 50, minId: anchor.msgId }), deadline, signal);
    for (const message of [...recent].reverse()) {
      if (message.out || message.id <= anchor.msgId) continue;
      const quoted = (message.replyTo as Api.MessageReplyHeader | undefined)?.replyToMsgId;
      if (quoted && quoted !== anchor.msgId) continue;
      const text = message.message ?? "";
      if (options.failContains && text.includes(options.failContains)) throw new Error("Telegram reply matched the failure indicator");
      if (options.successContains && !text.includes(options.successContains)) continue;
      if (options.button) {
        const markup = message.replyMarkup;
        if (!(markup instanceof Api.ReplyInlineMarkup)) continue;
        if (!markup.rows.some((row) => row.buttons.some((button) => button instanceof Api.KeyboardButtonCallback && (
          options.match === "contains" ? button.text.includes(options.button!) : button.text.trim() === options.button!.trim()
        )))) continue;
      }
      return message;
    }
    await pollDelay(deadline, signal);
  }
}

export async function clickWorkflowReplyButton(
  client: TelegramClient,
  peer: Api.TypeEntityLike,
  message: Api.Message,
  buttonText: string,
  match: "exact" | "contains",
  deadline: number,
  signal?: AbortSignal,
): Promise<string> {
  const markup = message.replyMarkup as Api.ReplyInlineMarkup;
  const button = markup.rows.flatMap((row) => row.buttons).find((b) => b instanceof Api.KeyboardButtonCallback && (
    match === "exact" ? b.text.trim() === buttonText.trim() : b.text.includes(buttonText)
  )) as Api.KeyboardButtonCallback | undefined;
  if (!button) throw new Error("The new reply has no matching callback button");
  const input = await within(() => client.getInputEntity(peer), deadline, signal);
  try {
    const answer = await within(() => client.invoke(new Api.messages.GetBotCallbackAnswer({
      peer: input, msgId: message.id, data: button.data,
    })), deadline, signal);
    return answer.message || "Callback button pressed";
  } catch (err: any) {
    if (!String(err?.message).includes("BOT_RESPONSE_TIMEOUT")) throw err;
    return "Callback button pressed; the bot did not answer the callback";
  }
}
