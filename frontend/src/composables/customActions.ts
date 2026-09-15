// One row of a custom job's action chain, as the editor holds it: loose strings the form binds
// to directly, converted to and from the config shape on the way in and out.
import type { CustomAction } from '../api/client';
import { webStepsFromConfig, webStepsToConfig, type WebStepForm } from './webSteps';

export type CustomActionForm = {
  type: 'send_command' | 'send_contact_message' | 'wait_reply' | 'delay' | 'click_button' | 'click_message_button' | 'ai_multiple_btn' | 'enter_captcha' | 'join_group' | 'subscribe_channel' | 'update_profile' | 'open_mini_app' | 'open_mini_app_url' | 'open_bot_menu_app' | 'open_url';
  content: string;
  contentDropdown: string;
  contentCustom: string;
  contentAiInputLength: string;
  maxWaitMs: number;
  waitMs: number;
  gapMs: number;
  button: string;
  buttonDropdown: string;
  buttonCustom: string;
  buttonAiHint: string;
  maxRetries: number;
  scope: number;
  captchaLength: string;
  successContains: string;
  failContains: string;
  cfChallenge: boolean;
  contact: string;
  groupId: string;
  checkMembership: boolean;
  verifyButton: string;
  verifyWaitMs: number;
  channelId: string;
  appButton: string;
  /** open_mini_app: browser budget, 0 = default */
  miniAppMaxWaitMs: number;
  /** open_mini_app: pinned browser proxy id, 'direct', or '' for the job proxy */
  miniAppProxyId: string;
  miniAppTryAllProxies: boolean;
  /** open_url: the page to open */
  url: string;
  /** open_url: sub-steps run on the page once it is up */
  webSteps: WebStepForm[];
  /** update_profile: new bio; blank clears it */
  profileAbout: string;
};

/**
 * The values the editor offers as presets. Anything else found in a config came from someone
 * typing it, so it opens as "custom" rather than being shown as a preset it never was.
 */
const CMD_PRESETS = new Set(['/start', '/checkin']);
const BTN_PRESETS = new Set(['签到', '{anyBtn}']);

/** A new action row, filled in with the values most jobs start from. */
export function defaultAction(): CustomActionForm {
  return {
    type: 'send_command', content: '/start', contentDropdown: '/start', contentCustom: '',
    contentAiInputLength: '', maxWaitMs: 30000, waitMs: 2000, gapMs: 1000, button: '签到',
    buttonDropdown: '签到', buttonCustom: '', buttonAiHint: '', maxRetries: 3, scope: 0,
    captchaLength: '', successContains: '', failContains: '', cfChallenge: false, contact: '', groupId: '', checkMembership: false,
    verifyButton: '', verifyWaitMs: 30000, channelId: '', appButton: '',
    miniAppMaxWaitMs: 300000, miniAppProxyId: '', miniAppTryAllProxies: true,
    url: '', webSteps: [],
    profileAbout: '',
  };
}

/** A stored action as an editable row. An unknown type comes back as a blank row. */
export function actionFromConfig(a: CustomAction): CustomActionForm {
  const base = defaultAction();
  if (a.type === 'send_command') {
    const aiInputMatch = a.content.match(/^\{aiInput(?::(\d+))?\}$/);
    if (aiInputMatch) return { ...base, type: 'send_command', content: a.content, contentDropdown: '{aiInput}', contentCustom: '', contentAiInputLength: aiInputMatch[1] ?? '', maxRetries: a.maxRetries ?? 0 };
    const contentDropdown = CMD_PRESETS.has(a.content) ? a.content : 'custom';
    return { ...base, type: 'send_command', content: a.content, contentDropdown, contentCustom: contentDropdown === 'custom' ? a.content : '', contentAiInputLength: '', maxRetries: a.maxRetries ?? 0 };
  }
  if (a.type === 'send_contact_message') {
    const aiInputMatch = a.content.match(/^\{aiInput(?::(\d+))?\}$/);
    if (aiInputMatch) return { ...base, type: 'send_contact_message', contact: a.contact, content: a.content, contentDropdown: '{aiInput}', contentCustom: '', contentAiInputLength: aiInputMatch[1] ?? '', maxRetries: a.maxRetries ?? 0 };
    const contentDropdown = CMD_PRESETS.has(a.content) ? a.content : 'custom';
    return { ...base, type: 'send_contact_message', contact: a.contact, content: a.content, contentDropdown, contentCustom: contentDropdown === 'custom' ? a.content : '', contentAiInputLength: '', maxRetries: a.maxRetries ?? 0 };
  }
  if (a.type === 'wait_reply') return { ...base, type: 'wait_reply', maxWaitMs: a.maxWaitMs, successContains: a.successContains ?? '', failContains: a.failContains ?? '', maxRetries: a.maxRetries ?? 0, scope: a.scope ?? 0 };
  if (a.type === 'delay') return { ...base, type: 'delay', waitMs: a.waitMs };
  if (a.type === 'enter_captcha') return { ...base, type: 'enter_captcha', maxWaitMs: a.maxWaitMs, captchaLength: String(a.captchaLength ?? ''), maxRetries: a.maxRetries ?? 0 };
  if (a.type === 'join_group') return { ...base, type: 'join_group', groupId: a.groupId, checkMembership: a.checkMembership ?? false, verifyButton: a.verifyButton ?? '', verifyWaitMs: a.verifyWaitMs ?? 30000 };
  if (a.type === 'subscribe_channel') return { ...base, type: 'subscribe_channel', channelId: a.channelId, checkMembership: a.checkMembership ?? false };
  if (a.type === 'update_profile') return { ...base, type: 'update_profile', profileAbout: a.about ?? '', maxRetries: a.maxRetries ?? 0 };
  if (a.type === 'open_mini_app') return { ...base, type: 'open_mini_app', contact: a.contact ?? '', button: a.button ?? '', appButton: (a.appButtons ?? []).join(' > '), successContains: a.successContains ?? '', failContains: a.failContains ?? '', maxRetries: a.maxRetries ?? 0, miniAppMaxWaitMs: a.maxWaitMs ?? 0, miniAppProxyId: a.proxyId ?? '', miniAppTryAllProxies: a.tryAllProxies ?? true };
  if (a.type === 'open_mini_app_url') return { ...base, type: 'open_mini_app_url', url: a.url ?? '', contact: a.contact ?? '', appButton: (a.appButtons ?? []).join(' > '), successContains: a.successContains ?? '', failContains: a.failContains ?? '', maxRetries: a.maxRetries ?? 0, miniAppMaxWaitMs: a.maxWaitMs ?? 0, miniAppProxyId: a.proxyId ?? '', miniAppTryAllProxies: a.tryAllProxies ?? true };
  if (a.type === 'open_bot_menu_app') return { ...base, type: 'open_bot_menu_app', contact: a.contact ?? '', appButton: (a.appButtons ?? []).join(' > '), successContains: a.successContains ?? '', failContains: a.failContains ?? '', maxRetries: a.maxRetries ?? 0, miniAppMaxWaitMs: a.maxWaitMs ?? 0, miniAppProxyId: a.proxyId ?? '', miniAppTryAllProxies: a.tryAllProxies ?? true };
  if (a.type === 'open_url') return { ...base, type: 'open_url', url: a.url ?? '', webSteps: webStepsFromConfig(a.steps), successContains: a.successContains ?? '', failContains: a.failContains ?? '', maxRetries: a.maxRetries ?? 0, miniAppMaxWaitMs: a.maxWaitMs ?? 0, miniAppProxyId: a.proxyId ?? '', miniAppTryAllProxies: a.tryAllProxies ?? true };
  if (a.type === 'ai_multiple_btn') return { ...base, type: 'ai_multiple_btn', contact: a.contact ?? '', buttonAiHint: a.hint ?? '', gapMs: a.gapMs ?? 1000, maxRetries: a.maxRetries, maxWaitMs: a.maxWaitMs, successContains: a.successContains ?? '', failContains: a.failContains ?? '', scope: a.scope ?? 0 };
  if (a.type === 'click_button' || a.type === 'click_message_button') {
    const aiMatch = a.button.match(/^\{aiBtn(?::(.+))?\}$/);
    let buttonDropdown: string;
    let buttonCustom = '';
    let buttonAiHint = '';
    if (aiMatch) { buttonDropdown = '{aiBtn}'; buttonAiHint = aiMatch[1]?.trim() ?? ''; }
    else if (BTN_PRESETS.has(a.button)) { buttonDropdown = a.button; }
    else { buttonDropdown = 'custom'; buttonCustom = a.button; }
    const shared = { ...base, button: a.button, buttonDropdown, buttonCustom, buttonAiHint, maxRetries: a.maxRetries, maxWaitMs: a.maxWaitMs, successContains: a.successContains ?? '', failContains: a.failContains ?? '', scope: a.scope ?? 0, cfChallenge: a.cfChallenge ?? false };
    if (a.type === 'click_button') return { ...shared, type: 'click_button' };
    return { ...shared, type: 'click_message_button', contact: a.contact };
  }
  return base;
}

/** An editable row as it is stored. Blank optional fields are left out rather than sent empty. */
export function actionToConfig(a: CustomActionForm): CustomAction {
  if (a.type === 'send_command') {
    let content: string;
    if (a.contentDropdown === '{aiInput}') {
      content = a.contentAiInputLength ? `{aiInput:${a.contentAiInputLength}}` : '{aiInput}';
    } else {
      content = a.contentDropdown === 'custom' ? a.contentCustom : a.contentDropdown;
    }
    return { type: 'send_command', content, ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}) };
  }
  if (a.type === 'send_contact_message') {
    let content: string;
    if (a.contentDropdown === '{aiInput}') {
      content = a.contentAiInputLength ? `{aiInput:${a.contentAiInputLength}}` : '{aiInput}';
    } else {
      content = a.contentDropdown === 'custom' ? a.contentCustom : a.contentDropdown;
    }
    return { type: 'send_contact_message', contact: a.contact, content, ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}) };
  }
  if (a.type === 'wait_reply') return {
    type: 'wait_reply',
    maxWaitMs: a.maxWaitMs,
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
    ...(a.scope ? { scope: a.scope } : {}),
  };
  if (a.type === 'delay') return { type: 'delay', waitMs: a.waitMs };
  if (a.type === 'enter_captcha') return {
    type: 'enter_captcha',
    maxWaitMs: a.maxWaitMs,
    captchaLength: a.captchaLength ? parseInt(a.captchaLength) || undefined : undefined,
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
  };
  if (a.type === 'join_group') return {
    type: 'join_group',
    groupId: a.groupId,
    ...(a.checkMembership ? { checkMembership: true } : {}),
    ...(a.verifyButton.trim() ? { verifyButton: a.verifyButton.trim(), verifyWaitMs: a.verifyWaitMs } : {}),
  };
  if (a.type === 'subscribe_channel') return { type: 'subscribe_channel', channelId: a.channelId, ...(a.checkMembership ? { checkMembership: true } : {}) };
  if (a.type === 'update_profile') return {
    type: 'update_profile',
    // Always sent, blank included: clearing the bio is a deliberate use of this step
    about: a.profileAbout,
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
  };
  if (a.type === 'open_mini_app') return {
    type: 'open_mini_app',
    ...(a.contact.trim() ? { contact: a.contact.trim() } : {}),
    ...(a.button.trim() ? { button: a.button.trim() } : {}),
    ...(a.appButton.trim() ? { appButtons: a.appButton.split(/->|>/).map(x => x.trim()).filter(Boolean) } : {}),
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
    ...(a.miniAppMaxWaitMs > 0 ? { maxWaitMs: a.miniAppMaxWaitMs } : {}),
    ...(a.miniAppProxyId ? { proxyId: a.miniAppProxyId } : {}),
    ...(a.miniAppTryAllProxies ? {} : { tryAllProxies: false }),
  };
  if (a.type === 'open_mini_app_url') return {
    type: 'open_mini_app_url',
    url: a.url.trim(),
    ...(a.contact.trim() ? { contact: a.contact.trim() } : {}),
    ...(a.appButton.trim() ? { appButtons: a.appButton.split(/->|>/).map(x => x.trim()).filter(Boolean) } : {}),
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
    ...(a.miniAppMaxWaitMs > 0 ? { maxWaitMs: a.miniAppMaxWaitMs } : {}),
    ...(a.miniAppProxyId ? { proxyId: a.miniAppProxyId } : {}),
    ...(a.miniAppTryAllProxies ? {} : { tryAllProxies: false }),
  };
  if (a.type === 'open_bot_menu_app') return {
    type: 'open_bot_menu_app',
    ...(a.contact.trim() ? { contact: a.contact.trim() } : {}),
    ...(a.appButton.trim() ? { appButtons: a.appButton.split(/->|>/).map(x => x.trim()).filter(Boolean) } : {}),
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
    ...(a.miniAppMaxWaitMs > 0 ? { maxWaitMs: a.miniAppMaxWaitMs } : {}),
    ...(a.miniAppProxyId ? { proxyId: a.miniAppProxyId } : {}),
    ...(a.miniAppTryAllProxies ? {} : { tryAllProxies: false }),
  };
  if (a.type === 'open_url') return {
    type: 'open_url',
    url: a.url.trim(),
    ...(a.webSteps.length ? { steps: webStepsToConfig(a.webSteps) } : {}),
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.maxRetries > 0 ? { maxRetries: a.maxRetries } : {}),
    ...(a.miniAppMaxWaitMs > 0 ? { maxWaitMs: a.miniAppMaxWaitMs } : {}),
    ...(a.miniAppProxyId ? { proxyId: a.miniAppProxyId } : {}),
    ...(a.miniAppTryAllProxies ? {} : { tryAllProxies: false }),
  };
  if (a.type === 'ai_multiple_btn') return {
    type: 'ai_multiple_btn',
    gapMs: a.gapMs,
    maxRetries: a.maxRetries,
    maxWaitMs: a.maxWaitMs,
    ...(a.contact.trim() ? { contact: a.contact.trim() } : {}),
    ...(a.buttonAiHint.trim() ? { hint: a.buttonAiHint.trim() } : {}),
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.scope ? { scope: a.scope } : {}),
  };
  let button: string;
  if (a.buttonDropdown === 'custom') button = a.buttonCustom;
  else if (a.buttonDropdown === '{aiBtn}') button = a.buttonAiHint.trim() ? `{aiBtn:${a.buttonAiHint.trim()}}` : '{aiBtn}';
  else button = a.buttonDropdown || '签到';
  if (a.type === 'click_message_button') return {
    type: 'click_message_button',
    contact: a.contact,
    button,
    maxRetries: a.maxRetries,
    maxWaitMs: a.maxWaitMs,
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.scope ? { scope: a.scope } : {}),
    ...(a.cfChallenge ? { cfChallenge: true } : {}),
  };
  return {
    type: 'click_button',
    button,
    maxRetries: a.maxRetries,
    maxWaitMs: a.maxWaitMs,
    ...(a.successContains.trim() ? { successContains: a.successContains.trim() } : {}),
    ...(a.failContains.trim() ? { failContains: a.failContains.trim() } : {}),
    ...(a.scope ? { scope: a.scope } : {}),
    ...(a.cfChallenge ? { cfChallenge: true } : {}),
  };
}
