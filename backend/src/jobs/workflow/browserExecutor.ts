import type { CustomAction, CustomStepLog } from "../../types";
import { openWebSession, runWebSteps, type CfRunState } from "../cloudflare";
import { cfMaxCandidates, cfProxyCandidatesFor } from "../../tg/proxyProviders";
import { cfRefusedFor } from "../cloudflare";
import { WorkflowContext, within } from "./context";

/** Executes browser operations against named resources; no Telegram dependency. */
export async function runBrowserAction(
  action: Extract<CustomAction, { type: "web_open" | "web_steps" }>,
  context: WorkflowContext,
  step: CustomStepLog,
  key: string,
  options: { profileScope: string; proxyUrl?: string; cfRun: CfRunState; aiLocate: (image: string, prompt: string) => Promise<string> },
): Promise<void> {
  if (!WorkflowContext.validName(action.session)) throw new Error("Web session name must be a valid identifier");
  const deadline = context.budget(key, action.maxWaitMs || 120_000);
  step.label = `${action.type === "web_open" ? "Open" : "Continue"} web session ${action.session}`;
  if (action.type === "web_open") {
    if (!/^https?:\/\//i.test(action.url)) throw new Error("Web session URL must start with http:// or https://");
    const previous = context.pages.get(action.session);
    context.pages.delete(action.session);
    await previous?.close();
    const candidates = cfProxyCandidatesFor({
      primaryUrl: options.proxyUrl, host: new URL(action.url).host,
      proxyId: action.proxyId, tryAll: action.tryAllProxies ?? true,
      exclude: cfRefusedFor(options.cfRun, new URL(action.url).host),
      max: action.tryAllProxies === false ? 1 : cfMaxCandidates(),
    });
    if (!candidates.length) throw new Error("No browser proxy candidates are available");
    const { browser, result } = await openWebSession(action.url, options.proxyUrl, {
      profileScope: options.profileScope, proxyCandidates: candidates,
      maxWaitMs: Math.max(1, deadline - Date.now()), signal: context.signal,
    });
    context.pages.set(action.session, browser);
    step.cfHost = result.finalHost;
    step.cfPassed = result.ok;
    step.cfChallenged = result.challenged;
    step.cfBuild = result.browserTier;
    step.cfProxy = result.proxyLabel;
    step.cfPageTitle = result.pageTitle;
    step.result = `Opened ${result.finalHost}; session ${action.session} remains available`;
  } else {
    const page = context.page(action.session);
    // Website sign-in belongs to the action chain. Keep the old combined login step in
    // open_url for compatibility, rather than coupling this browser executor to Telegram.
    if (action.steps.some((s) => s.type === "web_telegram_login"))
      throw new Error("Use separate Telegram actions between web session actions");
    const result = await within(() => runWebSteps(page, action.steps, deadline, {
      variables: context, signal: context.signal, aiLocate: options.aiLocate,
    }), deadline, context.signal);
    step.webSteps = result.logs;
    if (!result.ok) throw new Error(result.failure || "Web session steps failed");
    if (action.successContains || action.failContains) {
      const text = await within(() => page.locator("body").innerText({ timeout: Math.max(1, deadline - Date.now()) }), deadline, context.signal);
      if (action.failContains && text.includes(action.failContains)) throw new Error("Page matched the failure indicator");
      if (action.successContains && !text.includes(action.successContains)) throw new Error("Page did not contain the success indicator");
    }
    step.result = `Session ${action.session}: ${result.logs.length} page steps completed`;
  }
  step.cfScreenshot = await context.screenshot(context.page(action.session));
}
