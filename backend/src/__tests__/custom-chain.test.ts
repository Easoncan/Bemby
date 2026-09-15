// The finally chain: a list of steps that runs once after the main chain, whatever became of
// it -- succeeded, ran out of retries, or was cancelled. It exists to put the account back the
// way it was (a bio cleared of the keyword a checkin demanded). Its steps land in the run log
// like the chain's, tagged `phase: "cleanup"` so a report can rule a line under the chain and
// name what follows; a step failing in there is written down but does not change the verdict.

const {
  MockTelegramClient,
  MockUpdateProfile,
  mockConnect,
  mockDestroy,
  mockGetMe,
  mockInvoke,
  mockSendMessage,
} = vi.hoisted(() => {
  const mockConnect = vi.fn().mockResolvedValue(undefined);
  const mockDestroy = vi.fn().mockResolvedValue(undefined);
  const mockGetMe = vi.fn().mockResolvedValue({ firstName: 'Kept', lastName: 'Name' });
  const mockInvoke = vi.fn().mockResolvedValue(undefined);
  const mockSendMessage = vi.fn().mockResolvedValue({ id: 1, date: 1 });
  const MockTelegramClient = vi.fn().mockReturnValue({
    connect: mockConnect,
    destroy: mockDestroy,
    getMe: mockGetMe,
    invoke: mockInvoke,
    sendMessage: mockSendMessage,
    addEventHandler: vi.fn(),
    removeEventHandler: vi.fn(),
  });
  class MockUpdateProfile {
    constructor(public args: Record<string, unknown>) {}
  }
  return {
    MockTelegramClient,
    MockUpdateProfile,
    mockConnect,
    mockDestroy,
    mockGetMe,
    mockInvoke,
    mockSendMessage,
  };
});

vi.mock('telegram', () => ({
  TelegramClient: MockTelegramClient,
  Api: { account: { UpdateProfile: MockUpdateProfile } },
  Logger: vi.fn().mockReturnValue({}),
  utils: {},
}));
vi.mock('telegram/extensions/Logger', () => ({ LogLevel: { NONE: 0 } }));
vi.mock('telegram/sessions', () => ({ StringSession: vi.fn().mockReturnValue({}) }));
vi.mock('telegram/events', () => ({
  NewMessage: vi.fn(),
  NewMessageEvent: vi.fn(),
  Raw: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runCustom, CustomJobError } from '../jobs/custom';
import type { CustomAction, CustomConfig, CustomStepLog } from '../types';

type RunOpts = {
  maxRetries?: number;
  finallyActions?: CustomAction[];
  signal?: AbortSignal;
};

function run(actions: CustomAction[], opts: RunOpts = {}) {
  const config: CustomConfig = {
    actions,
    ...(opts.maxRetries ? { maxRetries: opts.maxRetries } : {}),
    ...(opts.finallyActions ? { finallyActions: opts.finallyActions } : {}),
  };
  return runCustom(
    12345,
    'hash',
    'session',
    'SomeBot',
    config,
    opts.signal,
    undefined,
    undefined,
    undefined,
  );
}

/** Run without throwing: how the run ended is half of what these tests are about. */
async function outcome(
  actions: CustomAction[],
  opts: RunOpts = {},
): Promise<{ steps: CustomStepLog[]; error: unknown }> {
  try {
    const log = await run(actions, opts);
    return { steps: log.steps, error: null };
  } catch (err) {
    if (err instanceof CustomJobError) return { steps: err.log.steps, error: err };
    return { steps: [], error: err };
  }
}

const failingSend = (over: Partial<CustomAction> = {}): CustomAction =>
  ({ type: 'send_command', content: '/start', maxRetries: 0, ...over }) as CustomAction;

const clearingBio = (over: Partial<CustomAction> = {}): CustomAction =>
  ({ type: 'update_profile', about: '', ...over }) as CustomAction;

beforeEach(() => {
  vi.clearAllMocks();
  mockConnect.mockResolvedValue(undefined);
  mockDestroy.mockResolvedValue(undefined);
  mockGetMe.mockResolvedValue({ firstName: 'Kept', lastName: 'Name' });
  mockInvoke.mockResolvedValue(undefined);
  mockSendMessage.mockResolvedValue({ id: 1, date: 1 });
});

describe('custom chain — the finally actions', () => {
  it('runs after a chain that worked, and is logged apart from it', async () => {
    const { steps, error } = await outcome([{ type: 'send_command', content: '/start' }], {
      finallyActions: [clearingBio()],
    });

    expect(error).toBeNull();
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0].args).toMatchObject({ about: '' });
    // Both ends of the run are kept. What tells them apart is the tag, not one being dropped.
    expect(steps.map((s) => s.actionType)).toEqual(['send_command', 'update_profile']);
    expect(steps.map((s) => s.phase)).toEqual([undefined, 'cleanup']);
  });

  it('runs after a chain that failed, and the failure still stands', async () => {
    mockSendMessage.mockRejectedValue(new Error('bot unreachable'));

    const { steps, error } = await outcome([failingSend()], {
      finallyActions: [clearingBio()],
    });

    expect((error as Error)?.message).toContain('bot unreachable');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(steps.map((s) => s.actionType)).toEqual(['send_command', 'update_profile']);
  });

  it('runs once for the run, not once per job attempt', async () => {
    // First attempt fails, the second works. The cleanup belongs to the run, not the attempt.
    mockSendMessage.mockRejectedValueOnce(new Error('first go failed'));

    const { steps, error } = await outcome([failingSend()], {
      maxRetries: 2,
      finallyActions: [clearingBio()],
    });

    expect(error).toBeNull();
    expect(steps.filter((s) => s.actionType === 'send_command')).toHaveLength(2);
    expect(steps.filter((s) => s.phase === 'cleanup')).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('still runs when every job attempt has failed', async () => {
    mockSendMessage.mockRejectedValue(new Error('bot unreachable'));

    const { steps, error } = await outcome([failingSend()], {
      maxRetries: 3,
      finallyActions: [clearingBio()],
    });

    expect((error as Error)?.message).toContain('bot unreachable');
    expect(steps.filter((s) => s.actionType === 'send_command')).toHaveLength(3);
    expect(steps.filter((s) => s.phase === 'cleanup')).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('runs even when the run was cancelled', async () => {
    const controller = new AbortController();
    controller.abort();

    const { error } = await outcome([{ type: 'send_command', content: '/start' }], {
      finallyActions: [clearingBio()],
      signal: controller.signal,
    });

    // Abandoning the run is exactly when the account most needs putting back.
    expect((error as Error)?.message).toBe('Job cancelled');
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('runs after a chain that stopped at its first failure', async () => {
    mockSendMessage.mockRejectedValue(new Error('bot unreachable'));

    const { steps, error } = await outcome(
      [failingSend(), { type: 'delay', waitMs: 1 }, clearingBio()],
      { finallyActions: [{ type: 'update_profile', about: 'put back' }] },
    );

    expect((error as Error)?.message).toContain('bot unreachable');
    // The rest of the chain assumed the send worked, so it is left alone -- while the cleanup
    // chain, which assumes nothing, still runs.
    expect(steps.map((s) => s.actionType)).toEqual(['send_command', 'update_profile']);
    expect(mockInvoke.mock.calls[0][0].args).toMatchObject({ about: 'put back' });
    expect(mockInvoke).toHaveBeenCalledTimes(1);
  });

  it('re-runs the chain from its first step after a failure', async () => {
    mockInvoke.mockRejectedValueOnce(new Error('flood wait'));

    const { steps, error } = await outcome(
      [
        { type: 'send_command', content: '/start' },
        { type: 'update_profile', about: 'keyword' },
      ],
      { maxRetries: 2 },
    );

    expect(error).toBeNull();
    // The retry starts the recipe over rather than resuming it: the send runs a second time.
    expect(steps.filter((s) => s.actionType === 'send_command')).toHaveLength(2);
    expect(steps.filter((s) => s.actionType === 'update_profile')).toHaveLength(2);
  });

  it('runs the whole cleanup chain, in order', async () => {
    const { error } = await outcome([{ type: 'send_command', content: '/start' }], {
      finallyActions: [
        { type: 'update_profile', about: 'first' },
        { type: 'update_profile', about: 'second' },
      ],
    });

    expect(error).toBeNull();
    expect(mockInvoke.mock.calls.map((c) => c[0].args.about)).toEqual(['first', 'second']);
  });

  it('logs a cleanup step that failed, without failing the run', async () => {
    mockGetMe.mockRejectedValue(new Error('flood wait'));

    const { steps, error } = await outcome([{ type: 'send_command', content: '/start' }], {
      finallyActions: [clearingBio()],
    });

    // The chain succeeded, so the run succeeds: a cleanup that could not do its job is not
    // allowed to change that. The step is still written down, so the account being left as it
    // was found is something the report shows rather than hides.
    expect(error).toBeNull();
    expect(steps.map((s) => s.actionType)).toEqual(['send_command', 'update_profile']);
    expect(steps[1].phase).toBe('cleanup');
    expect(steps[1].error).toContain('flood wait');
  });

  it('numbers the cleanup steps within their own group', async () => {
    const { steps } = await outcome([{ type: 'send_command', content: '/start' }], {
      maxRetries: 3,
      finallyActions: [
        { type: 'update_profile', about: 'one' },
        { type: 'update_profile', about: 'two' },
      ],
    });

    const cleanup = steps.filter((s) => s.phase === 'cleanup');
    // They count from 1 again, so the divider is what places them -- and no job attempt is
    // attached, because the pass that carried them is not a retry of anything.
    expect(cleanup.map((s) => s.step)).toEqual([1, 2]);
    expect(cleanup.map((s) => s.jobAttempt)).toEqual([undefined, undefined]);
  });
});

describe('custom action — update_profile', () => {
  it('sets the bio and passes the account name through untouched', async () => {
    await run([{ type: 'update_profile', about: 'hello world' }]);

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke.mock.calls[0][0].args).toMatchObject({
      about: 'hello world',
      firstName: 'Kept',
      lastName: 'Name',
    });
  });

  it('clears the bio when the step is left blank', async () => {
    await run([clearingBio()]);

    expect(mockInvoke.mock.calls[0][0].args).toMatchObject({ about: '' });
  });

  it('refuses a bio Telegram would reject rather than sending it', async () => {
    const { steps } = await outcome([{ type: 'update_profile', about: 'x'.repeat(141) }]);

    expect(steps[0].error).toContain('140');
    expect(mockInvoke).not.toHaveBeenCalled();
  });

  it('refuses an account Telegram would refuse the update for', async () => {
    mockGetMe.mockResolvedValue({ firstName: '', lastName: '' });

    const { steps } = await outcome([clearingBio()]);

    expect(steps[0].error).toContain('first name');
    expect(mockInvoke).not.toHaveBeenCalled();
  });
});
