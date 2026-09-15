/**
 * 卡片凭据状态源的纯逻辑契约。
 *
 * 两个决策点值得单独钉住：**引用名换了，旧答案立即作废**；
 * **写失败必须抛给用户看**，不能安静地停在「未配置」让人以为保存成功了。
 */

import { describe, expect, it } from 'vitest';
import {
  createCredentialStore,
  type CredentialView,
  type CredentialsRemoteFace,
  type RemoteOutcome,
} from '../src/client/credential-store.js';

/** 一个可以手动 settle 的 Promise，用于制造乱序响应。 */
function deferred<T>() {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

/** 只实现被用到的两个方法的替身。 */
function fakeRemote(overrides: Partial<CredentialsRemoteFace> = {}): CredentialsRemoteFace {
  return {
    describe: async () => ({ ok: true, value: {} }),
    set: async () => ({ ok: true, value: undefined }),
    ...overrides,
  };
}

/** 常量引用名。 */
const fixed = (ref: string) => () => ref;

describe('createCredentialStore', () => {
  it('初值不谎称已配置', () => {
    const store = createCredentialStore(() => fakeRemote(), fixed('ZHIHU_ACCESS_SECRET'));
    expect(store.getSnapshot()).toEqual({ ref: '', configured: false, writable: true });
  });

  it('读到状态后如实上报 configured 与 writable', async () => {
    const store = createCredentialStore(
      () =>
        fakeRemote({
          describe: async (refs) => ({
            ok: true,
            value: Object.fromEntries(refs.map((ref) => [ref, { configured: true, writable: false }])),
          }),
        }),
      fixed('MY_KEY'),
    );
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ ref: 'MY_KEY', configured: true, writable: false });
  });

  it('引用名换了，状态立刻回到「未配置」而不是留着上一条的答案', async () => {
    let ref = 'A';
    const gate = deferred<RemoteOutcome<Record<string, CredentialView>>>();
    const store = createCredentialStore(() => fakeRemote({ describe: () => gate.promise }), () => ref);

    const first = store.refresh();
    ref = 'B';
    gate.settle({ ok: true, value: { A: { configured: true, writable: true } } });
    await first;

    expect(store.getSnapshot()).toEqual({ ref: 'B', configured: false, writable: true });
  });

  it('引用名为空时不发请求（还没配过引用名）', async () => {
    let asked = 0;
    const store = createCredentialStore(
      () =>
        fakeRemote({
          describe: async () => {
            asked += 1;
            return { ok: true, value: {} };
          },
        }),
      fixed(''),
    );
    await store.refresh();
    expect(asked).toBe(0);
    expect(store.getSnapshot().ref).toBe('');
  });

  it('读失败时保持原状态，不把失败说成「未配置」', async () => {
    const store = createCredentialStore(
      () => fakeRemote({ describe: async () => ({ ok: false, error: new Error('网关挂了') }) }),
      fixed('MY_KEY'),
    );
    await store.refresh();
    expect(store.getSnapshot()).toEqual({ ref: 'MY_KEY', configured: false, writable: true });
  });

  it('写成功后重读，徽标跟着变', async () => {
    let stored = false;
    const store = createCredentialStore(
      () =>
        fakeRemote({
          describe: async (refs) => ({
            ok: true,
            value: Object.fromEntries(refs.map((ref) => [ref, { configured: stored, writable: true }])),
          }),
          set: async () => {
            stored = true;
            return { ok: true, value: undefined };
          },
        }),
      fixed('MY_KEY'),
    );

    await store.write('MY_KEY', 'sk-x');
    expect(stored).toBe(true);
    expect(store.getSnapshot().configured).toBe(true);
  });

  it('写失败时抛出，让卡片有东西可显示', async () => {
    const store = createCredentialStore(
      () =>
        fakeRemote({
          set: async () => ({ ok: false, error: new Error('该引用被只读来源遮蔽') }),
        }),
      fixed('MY_KEY'),
    );
    await expect(store.write('MY_KEY', 'sk-x')).rejects.toThrow('该引用被只读来源遮蔽');
  });

  it('状态没变时不通知订阅者（useSyncExternalStore 要求快照稳定）', async () => {
    let notified = 0;
    const store = createCredentialStore(() => fakeRemote(), fixed('MY_KEY'));
    store.subscribe(() => {
      notified += 1;
    });
    await store.refresh();
    await store.refresh();
    // 第一次刷新把 ref 从 '' 推到 'MY_KEY'，第二次没有任何变化。
    expect(notified).toBe(1);
  });
});
