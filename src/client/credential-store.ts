/**
 * 凭据域在卡片上的那一小块状态。
 *
 * 独立成模块的理由与 Host 侧 [credentials.ts](../credentials.ts) 相同：
 * 这里有一个值得脱离 React 单测的决策点 ——「引用名所指的记录配好了吗、能不能写」。
 *
 * 引用名会变（卡片上是一个自由输入框），所以状态与它所描述的那个引用名绑在一起发布：
 * 两次读可能乱序 settle，一个迟到的响应只有在它仍然回答**当前**引用名时才算数。
 */

/** Remote 调用的结果：失败折进 `error` 分支，而不是抛。 */
export type RemoteOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

/** 一条引用的配置状态；不含任何密钥值。 */
export interface CredentialView {
  /** 该引用名当下取不取得到值（环境变量这类只读层也算）。 */
  readonly configured: boolean;
  /** 现在能不能写进去；只读来源遮蔽时为 `false`。 */
  readonly writable: boolean;
}

/** 卡片渲染所需的快照。 */
export interface CredentialState extends CredentialView {
  /** 这份状态回答的是哪个引用名。 */
  readonly ref: string;
}

/** `ctx.remote.credentials` 在本卡片用到的最小面。 */
export interface CredentialsRemoteFace {
  describe(refs: readonly string[]): Promise<RemoteOutcome<Record<string, CredentialView>>>;
  set(ref: string, value: string): Promise<RemoteOutcome<unknown>>;
}

/** 卡片的凭据状态源。 */
export interface CredentialStore {
  /** 交给 `useSyncExternalStore`。 */
  subscribe(onChange: () => void): () => void;
  /** 交给 `useSyncExternalStore`；状态没变时返回同一个对象。 */
  getSnapshot(): CredentialState;
  /** 重新读一次；Host 报告该引用名变化时调用。 */
  refresh(): Promise<void>;
  /**
   * 把密钥写进凭据域，然后重读状态。
   *
   * 失败时**抛出**而不是吞掉：写不进去必须让用户看见，
   * 否则徽标会安静地停在「未配置」而用户以为保存成功了。
   *
   * @param ref - 写进哪个引用名。
   * @param value - 非空密钥值。
   */
  write(ref: string, value: string): Promise<void>;
}

/**
 * 建一个凭据状态源。
 *
 * `remote` 是 thunk 而不是取好的对象：装配期不该解引用 `ctx.remote`，
 * 那样测试就得伪造一个完整的 Remote 面。
 *
 * @param remote - 取 `ctx.remote.credentials` 的函数。
 * @param readRef - 读**当前生效**的引用名（设置里存下来的那个，不是编辑中的草稿）。
 * @returns 状态源。
 */
export function createCredentialStore(
  remote: () => CredentialsRemoteFace,
  readRef: () => string,
): CredentialStore {
  // 初值刻意是「未配置」：在第一次读回来之前，不谎称已配置。
  let state: CredentialState = { ref: '', configured: false, writable: true };
  const listeners = new Set<() => void>();

  const publish = (next: CredentialState): void => {
    if (next.ref === state.ref && next.configured === state.configured && next.writable === state.writable) {
      return;
    }
    state = next;
    for (const listener of listeners) listener();
  };

  const read = async (): Promise<void> => {
    const ref = readRef();
    // 引用名一换，旧答案立即作废 —— 否则徽标会拿上一条记录的状态回答新名字。
    if (ref !== state.ref) publish({ ref, configured: false, writable: true });
    if (ref === '') return;

    const result = await remote().describe([ref]);
    const latest = readRef();
    if (ref !== latest) {
      // 迟到的响应不再回答当前引用名：丢弃它，并把状态拉回当前引用名，
      // 免得徽标停在一条早已作废的答案上。
      publish({ ref: latest, configured: false, writable: true });
      return;
    }
    if (!result.ok) return;
    const view = result.value[ref];
    publish({ ref, configured: view?.configured ?? false, writable: view?.writable ?? true });
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    getSnapshot: () => state,
    refresh: read,
    write: async (ref, value) => {
      const result = await remote().set(ref, value);
      if (!result.ok) throw result.error;
      await read();
    },
  };
}
