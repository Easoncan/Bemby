import type { Page } from "playwright-core";
import type { ActionCondition } from "../../types";
import { escapeHtml } from "../../tg/htmlEscape";

export interface WorkflowVariables {
  render<T>(value: T): T;
  set(name: string, value: string, sensitive?: boolean): void;
  redact(value: string): string;
  isSensitive(value: string): boolean;
  mask(page: Page, selector: string): void;
  screenshot(page: Page, quality?: number, clip?: { x: number; y: number; width: number; height: number }): Promise<string | undefined>;
}

export type MessageAnchor = { msgId: number; peerId: string };
export type WebSession = { page: Page; close: () => Promise<void> };

export function checkDeadline(deadline: number, signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("Job cancelled");
  if (Date.now() >= deadline) throw new Error("Workflow time limit reached");
}

export async function within<T>(work: () => Promise<T>, deadline: number, signal?: AbortSignal): Promise<T> {
  checkDeadline(deadline, signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  const stopped = new Promise<never>((_, reject) => {
    if (Number.isFinite(deadline)) timer = setTimeout(() => reject(new Error("Workflow time limit reached")), Math.max(1, deadline - Date.now()));
    abort = () => reject(new Error("Job cancelled"));
    signal?.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([work(), stopped]);
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}

export async function pollDelay(deadline: number, signal?: AbortSignal): Promise<void> {
  await within(() => new Promise<void>((resolve) => setTimeout(resolve, Math.max(1, Math.min(500, deadline - Date.now())))), deadline, signal);
}

export async function workflowDelay(milliseconds: number, deadline: number, signal?: AbortSignal): Promise<void> {
  checkDeadline(deadline, signal);
  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error); else resolve();
    };
    const onAbort = () => finish(new Error("Job cancelled"));
    const duration = Math.min(Math.max(0, milliseconds), deadline - Date.now());
    const timer = setTimeout(() => finish(Date.now() >= deadline ? new Error("Workflow time limit reached") : undefined), Math.max(0, duration));
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function extractText(value: string, pattern?: string, group?: number): string {
  if (!pattern) return value;
  const match = value.match(new RegExp(pattern));
  if (!match) throw new Error("Extraction pattern did not match");
  const result = match[group ?? (match.length > 1 ? 1 : 0)];
  if (result === undefined) throw new Error("Extraction capture group does not exist");
  return result;
}

/** One attempt owns its values and pages; nothing is global or persisted as task data. */
export class WorkflowContext implements WorkflowVariables {
  private values = new Map<string, string>();
  private secrets = new Set<string>();
  private masks = new WeakMap<Page, Set<string>>();
  readonly messages = new Map<string, MessageAnchor>();
  readonly pages = new Map<string, WebSession>();
  private budgets = new Map<string, number>();

  constructor(public deadline = Infinity, public signal?: AbortSignal) {}

  budget(key: string, milliseconds = 30_000): number {
    const until = this.budgets.get(key) ?? Math.min(this.deadline, Date.now() + (milliseconds > 0 ? milliseconds : 30_000));
    this.budgets.set(key, until);
    checkDeadline(until, this.signal);
    return until;
  }

  static validName(name: string): boolean {
    return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(name);
  }

  set(name: string, value: string, sensitive = false): void {
    if (!WorkflowContext.validName(name)) throw new Error(`Invalid variable name: ${name}`);
    const inherited = this.isSensitive(value);
    this.values.set(name, value);
    if ((sensitive || inherited) && value) {
      // A page can render a command and its token separately. Protect both presentations.
      const parts = [value, ...value.split(/\s+/).filter((part) => part.length >= 4 && !part.startsWith("/"))];
      for (const part of parts)
        for (const variant of [part, escapeHtml(part), encodeURIComponent(part)]) this.secrets.add(variant);
    }
  }

  render<T>(value: T): T {
    if (typeof value === "string") {
      return value.replace(/\$\{vars\.([^}]+)\}/g, (_token, name: string) => {
        if (!this.values.has(name)) throw new Error(`Variable is not defined: ${name}`);
        return this.values.get(name)!;
      }) as T;
    }
    if (Array.isArray(value)) return value.map((v) => this.render(v)) as T;
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, this.render(v)])) as T;
    return value;
  }

  matches(condition?: ActionCondition): boolean {
    if (!condition) return true;
    const exists = this.values.has(condition.variable);
    if (condition.operator === "exists") return exists;
    if (condition.operator === "not_exists") return !exists;
    if (!exists) throw new Error(`Condition variable is not defined: ${condition.variable}`);
    const value = this.values.get(condition.variable)!;
    const expected = this.render(condition.value ?? "");
    switch (condition.operator) {
      case "equals": return value === expected;
      case "not_equals": return value !== expected;
      case "contains": return value.includes(expected);
      default: throw new Error("Unknown workflow condition operator");
    }
  }

  isSensitive(value: string): boolean {
    return !!value && [...this.secrets].some((secret) => value.includes(secret) || (value.length >= 4 && secret.includes(value)));
  }

  redact(value: string): string {
    let result = value;
    for (const secret of [...this.secrets].sort((a, b) => b.length - a.length))
      result = result.split(secret).join("[redacted]");
    return result;
  }

  sanitize(value: unknown): void {
    if (!value || typeof value !== "object") return;
    for (const [key, item] of Object.entries(value)) {
      // Images are masked at capture time; replacing substrings would corrupt base64.
      if (/screenshot|image/i.test(key)) continue;
      if (typeof item === "string") (value as Record<string, unknown>)[key] = this.redact(item);
      else this.sanitize(item);
    }
  }

  mask(page: Page, selector: string): void {
    const selectors = this.masks.get(page) ?? new Set<string>();
    selectors.add(selector);
    this.masks.set(page, selectors);
  }

  screenshot = async (page: Page, quality = 45, clip?: { x: number; y: number; width: number; height: number }): Promise<string | undefined> => {
    const mask = [...(this.masks.get(page) ?? [])].map((selector) => page.locator(selector));
    mask.push(page.locator('input[type="password"]'));
    for (const value of this.secrets) mask.push(page.getByText(value, { exact: false }));
    const buffer = await page.screenshot({ type: "jpeg", quality, mask, maskColor: "#29313b", timeout: Math.max(1, Math.min(3000, this.deadline - Date.now())), ...(clip ? { clip } : {}) }).catch(() => undefined);
    if (!buffer || buffer.length > 525_000) return undefined;
    return `data:image/jpeg;base64,${buffer.toString("base64")}`;
  };

  page(name: string): Page {
    const session = this.pages.get(name);
    if (!session) throw new Error(`Web session is not open: ${name}`);
    return session.page;
  }

  anchor(id: string, peerId: string): MessageAnchor {
    const anchor = this.messages.get(id);
    if (!anchor) throw new Error(`No sent message output for step: ${id}`);
    if (anchor.peerId !== peerId) throw new Error(`Step ${id} belongs to a different Telegram conversation`);
    return anchor;
  }

  async close(): Promise<void> {
    const sessions = [...this.pages.values()];
    this.pages.clear();
    await Promise.allSettled(sessions.map((session) => session.close()));
  }
}
