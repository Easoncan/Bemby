import type { Page } from "playwright-core";
import type { WebStep } from "../../types";
import { extractText, pollDelay, within, type WorkflowVariables } from "./context";

/** Browser capability only: it knows nothing about Telegram or site-specific login flows. */
export async function extractWebValue(
  page: Page,
  step: Extract<WebStep, { type: "web_extract" }>,
  deadline: number,
  variables: WorkflowVariables | undefined,
  signal?: AbortSignal,
): Promise<string> {
  if (!variables) throw new Error("Variable extraction requires a custom workflow");
  if (step.source !== "url" && !step.selector?.trim()) throw new Error("Extraction needs an element selector");
  if (step.source === "attribute" && !step.attribute?.trim()) throw new Error("Extraction needs an attribute name");
  const sensitive = step.source !== "exists" && step.sensitive !== false;
  if (sensitive && step.selector) variables.mask(page, step.selector);
  const until = Math.min(deadline, Date.now() + (step.waitMs && step.waitMs > 0 ? step.waitMs : 30_000));
  for (;;) {
    let value: string | null;
    try {
      value = await within(() => page.evaluate((args) => {
        if (args.source === "url") return location.href;
        const elements = Array.from(document.querySelectorAll(args.selector!)) as HTMLElement[];
        const element = elements.find((el) => {
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden" && (!args.matchText || (el.innerText ?? el.textContent ?? "").trim() === args.matchText);
        });
        if (args.source === "exists") return String(!!element);
        if (!element) return null;
        if (args.source === "attribute") return element.getAttribute(args.attribute!);
        if (args.source === "value") return String((element as HTMLInputElement).value ?? "");
        return element.innerText ?? element.textContent ?? "";
      }, { source: step.source, selector: step.selector, matchText: step.matchText, attribute: step.attribute }), until, signal);
    } catch (err: any) {
      if (!/execution context was destroyed|cannot find context|unable to adopt element/i.test(String(err?.message))) throw err;
      value = null;
    }
    if (value !== null) {
      const result = extractText(value, step.pattern, step.group);
      variables.set(step.saveAs, result, sensitive);
      return `Saved ${step.saveAs}: ${sensitive ? "[redacted]" : variables.redact(result.slice(0, 200))}`;
    }
    await pollDelay(until, signal);
  }
}
