import { describe, expect, it, vi } from "vitest";
import { Api, type TelegramClient } from "telegram";
import { waitWorkflowReply, clickWorkflowReplyButton } from "../jobs/workflow/telegramSteps";

const markup = (text: string) => new Api.ReplyInlineMarkup({ rows: [new Api.KeyboardButtonRow({ buttons: [new Api.KeyboardButtonCallback({ text, data: Buffer.from(text) })] })] });

describe("workflow Telegram reply scope", () => {
  it("ignores old, outgoing, differently quoted and wrong-label messages", async () => {
    const getMessages = vi.fn().mockResolvedValue([
      { id: 105, out: false, replyTo: { replyToMsgId: 98 }, replyMarkup: markup("Confirm") },
      { id: 104, out: false, replyMarkup: markup("Confirm") },
      { id: 103, out: false, replyMarkup: markup("Confirm another thing") },
      { id: 102, out: true, replyMarkup: markup("Confirm") },
      { id: 99, out: false, replyMarkup: markup("Confirm") },
    ]);
    const invoke = vi.fn().mockResolvedValue({ message: "ok" });
    const client = { getMessages, invoke, getInputEntity: async () => new Api.InputPeerSelf() } as unknown as TelegramClient;
    const message = await waitWorkflowReply(client, "bot", { msgId: 100, peerId: "1" }, { button: "Confirm", match: "exact" }, Date.now() + 1000);
    expect(message.id).toBe(104);
    await clickWorkflowReplyButton(client, "bot", message, "Confirm", "exact", Date.now() + 1000);
    expect(invoke).toHaveBeenCalledWith(expect.objectContaining({ msgId: 104 }));
  });

  it("fails on an explicit failure reply and bounds a missing reply", async () => {
    const client = { getMessages: vi.fn().mockResolvedValue([{ id: 101, out: false, message: "Code expired" }]) } as unknown as TelegramClient;
    await expect(waitWorkflowReply(client, "bot", { msgId: 100, peerId: "1" }, { failContains: "expired" }, Date.now() + 1000)).rejects.toThrow("failure indicator");
    await expect(waitWorkflowReply(client, "bot", { msgId: 100, peerId: "1" }, { button: "Confirm" }, Date.now() + 25)).rejects.toThrow("time limit");
  });
});
