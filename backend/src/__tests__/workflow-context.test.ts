import { describe, expect, it, vi } from "vitest";
import { WorkflowContext, extractText, within, workflowDelay } from "../jobs/workflow/context";

describe("workflow values and conditions", () => {
  it("keeps values local to one attempt and interpolates only the original template", () => {
    const a = new WorkflowContext();
    const b = new WorkflowContext();
    a.set("command", "${vars.other}");
    expect(a.render("send ${vars.command}")).toBe("send ${vars.other}");
    expect(() => b.render("${vars.command}")).toThrow("not defined");
    expect(() => a.render("${vars.unknown}")).toThrow("not defined");
    expect(() => a.set("not a name", "x")).toThrow("Invalid variable name");
  });

  it("handles boolean text, explicit skip conditions and missing variables", () => {
    const ctx = new WorkflowContext();
    ctx.set("logged_in", "false");
    expect(ctx.matches({ variable: "logged_in", operator: "equals", value: "false" })).toBe(true);
    expect(ctx.matches({ variable: "logged_in", operator: "equals", value: "true" })).toBe(false);
    expect(ctx.matches({ variable: "missing", operator: "not_exists" })).toBe(true);
    expect(() => ctx.matches({ variable: "missing", operator: "equals", value: "false" })).toThrow("not defined");
  });

  it("protects a token rendered both alone and as part of a command, including HTML and URLs", () => {
    const ctx = new WorkflowContext();
    ctx.set("command", "/login ABCD123456", true);
    ctx.set("derived", extractText(ctx.render("${vars.command}"), "([A-Z0-9]{10})"), false);
    const log = { label: "/login ABCD123456", responseHtml: "<code>ABCD123456</code>", nested: { text: "ABCD123456" }, cfScreenshot: "data:image/jpeg;base64,ABCD123456" };
    ctx.sanitize(log);
    expect(log.label).not.toContain("ABCD123456");
    expect(log.responseHtml).not.toContain("ABCD123456");
    expect(log.nested.text).toBe("[redacted]");
    expect(log.cfScreenshot).toContain("ABCD123456");
    expect(ctx.isSensitive("prefix ABCD123456 suffix")).toBe(true);
  });

  it("extracts whole matches or capture groups and fails on an invalid match", () => {
    expect(extractText("OTP: 654321", "OTP: (\\d+)")).toBe("654321");
    expect(extractText("OTP: 654321", "\\d+")).toBe("654321");
    expect(extractText("OTP: 654321", "OTP: (\\d+)", 0)).toBe("OTP: 654321");
    expect(() => extractText("none", "\\d+")).toThrow("did not match");
  });

  it("checks the peer on message references", () => {
    const ctx = new WorkflowContext();
    ctx.messages.set("send", { msgId: 100, peerId: "bot1" });
    expect(ctx.anchor("send", "bot1").msgId).toBe(100);
    expect(() => ctx.anchor("send", "bot2")).toThrow("different Telegram conversation");
    expect(() => ctx.anchor("old_attempt", "bot1")).toThrow("No sent message");
  });

  it("closes every resource even when one close fails, and only closes them once", async () => {
    const ctx = new WorkflowContext();
    const a = vi.fn().mockRejectedValue(new Error("closed"));
    const b = vi.fn().mockResolvedValue(undefined);
    ctx.pages.set("a", { page: {} as any, close: a });
    ctx.pages.set("b", { page: {} as any, close: b });
    await ctx.close();
    await ctx.close();
    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it("reuses an action's deadline across retries and bounds pending network calls", async () => {
    const ctx = new WorkflowContext(Date.now() + 1000);
    const first = ctx.budget("step", 100);
    expect(ctx.budget("step", 1000)).toBe(first);
    await expect(within(() => new Promise(() => {}), Date.now() + 20)).rejects.toThrow("time limit");
    const abort = new AbortController();
    abort.abort();
    await expect(within(async () => true, Infinity, abort.signal)).rejects.toThrow("cancelled");
    expect(await within(async () => "ok", Infinity)).toBe("ok");
  });

  it("bounds configured delays and cleans up their abort listeners", async () => {
    await expect(workflowDelay(10000, Date.now() + 20)).rejects.toThrow("time limit");
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const waiting = workflowDelay(10000, Infinity, controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("cancelled");
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
  });
});
