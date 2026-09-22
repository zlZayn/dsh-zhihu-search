/**
 * 浏览器半体：侧边栏「插件（Plugins）」→「已安装（Installed）」组 → dsh-zhihu-search 那一行的
 * **Configure** 页里的「知乎搜索」配置卡片。
 *
 * 挂载点是插件管理页声明的 `plugins.row.config` 槽（0.1.7 起；旧槽 `plugins.bundle.config`
 * 还在，但渲染它时页面**不传 `form`**，卡片拿不到读写面），key 是 `<包名>#<行 id>`，
 * 两半逐字取自本仓自己的声明：[package.json](../../package.json) 的 `name` 与
 * [cordis.patch.yml](../../cordis.patch.yml) 那条 insert 的 `id`。
 * 写错 key 的表现是整块配置不出现，且页面不报错 —— 由
 * [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 解析这两个文件对账。
 *
 * 外壳对齐原生配置表单（`ui-settings-plugins` 的 PluginConfigForm + fields）：不可折叠、无外框，
 * 一列控件直接落在插件页的 `data-plugin-config` 区里；只读提示行 + 字段行（标签 / 状态标记 / 重置）
 * + 底部「失败诊断 + 单一保存按钮」（无分割线，按钮左对齐）。
 * 草稿随卸载丢弃，只有保存才写；保存成功由 Host 回读确认。
 *
 * 文案全部走 DSH 的 locale 服务（`ctx.locale`），不硬编码 —— 字典在 [locales.ts](./locales.ts)，
 * 注册时用 `locale:` 声明命名空间，框架据此把类型化的 `t` 座位注入组件 props。
 * 切语言无需重挂载：字典注册会推进 locale 版本号，已挂载的出口自动重取。
 *
 * 密钥**不经过配置文件**：它按引用名写进 `ctx.remote.credentials`（即 `.credentials.yaml`），
 * 与官方 web 搜索卡片同一套做法。配置里只留引用名，因此活动 profile 的 Cordis patch
 * 被截图或上传时不泄任何凭据。
 *
 * 复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Tag` 与 `Switch`：那是公共基础库，
 * 不是别的插件 —— 被 bundle-purity gate 禁止的是跨插件值导入。
 * 其余控件按官方 CSS 自带样式，取值只用 `--dsw-alias-*` 语义令牌。
 */

import { useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Context } from '@deepseek-ai/cordis';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
// 类型导入即声明：`plugins.row.config` 槽由插件管理页的浏览器半体合并进 SlotMap，
// 而 `ConfigPageForm`（宿主那侧算好的表单读写面）也从同一个入口导出 ——
// 卡片刻意不欠 `dsh-client-ui-settings` 任何**类型边**：它只经由槽位 props 拿到表单。
import type { ConfigPageForm } from '@deepseek-ai/dsh-client-ui-plugin-manager/client';
// 类型导入即声明：`ctx.locale` 由 locale 包的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-locale/client';
// 类型导入即声明：ctx.slots 由 ui-renderer 的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { createCredentialStore, type CredentialView, type CredentialsRemoteFace } from './credential-store.js';
import { LOCALE_NS, ZHIHU_LOCALES } from './locales.js';

/**
 * `ctx.remote` 在本卡片用到的最小面。
 *
 * 收窄类型用**结构类型**而不是 `import type {} from '@deepseek-ai/dsh-api-remotes/client'`：
 * 那是客户端的装配包，只为声明 `ctx.remote` 就把它加进 `peerDependencies` 不划算，
 * 而本卡片只碰 `credentials` 一个命名空间。
 *
 * 类型与运行时是两件事：这里的收窄只解决类型，**能不能属性访问由 {@link inject} 决定**。
 */
interface ClientRemoteFace {
  readonly credentials: CredentialsRemoteFace;
  /** 订阅宿主广播的凭据变更；返回撤销函数。 */
  $on(event: 'credentials/reference-updated', listener: (ref: string) => void): () => void;
}

/**
 * 取 `ctx.remote` 并收窄到 {@link ClientRemoteFace}。
 *
 * 属性访问**要求服务名逐字出现在本 fiber 的 `inject` 里** —— 见 {@link inject} 的说明。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 * @returns 收窄后的 Remote 面。
 */
function remoteOf(ctx: Context): ClientRemoteFace {
  return (ctx as unknown as { remote: ClientRemoteFace }).remote;
}

/**
 * 依赖的浏览器端服务。
 *
 * `locale` 是硬依赖：注册时声明了 `locale:`，渲染就需要已安装的 locale 面，
 * 缺席时 DSH 会直接报错而不是降级。标准 web 装配必然带它
 * （DSH `packages/bundle/web-app` 依赖 `dsh-client-locale`）。
 *
 * **`remote` 与 `remote.credentials` 两个都要写，缺一不可**：
 * - `remote.credentials` 是点号服务名（gateway 按 `remote.<namespace>` 提供），负责等命名空间就绪；
 * - `remote` 负责让 `ctx.remote` 这个**属性访问**合法。
 *
 * Cordis 的判据是「服务名逐字出现在某个 fiber 的 `inject` 里」，点号键**不会**展开成父级。
 * 只写点号键的后果不是降级而是整块装不上：`cannot get property "remote" without inject`（v1.6.0 的回归）。
 * 官方 `ui-settings-plugins` 同样两个都写。
 */
export const inject = ['slots', 'remote', 'remote.credentials', 'locale'];

/**
 * 槽位分派 key 的两半。
 *
 * 插件页按 `<包名>#<行 id>` 取某一行的配置（DSH `config-ledger.ts` 的 `rowConfigKey`）：
 * - 前半是 bundle 的**包名** = [package.json](../../package.json) 的 `name`；
 * - 后半是 bundle patch 里那条 insert 的 **id** = [cordis.patch.yml](../../cordis.patch.yml)。
 *
 * 两半都不是「随便一个字符串」：包名写错 = 整块配置不出现，行 id 写错 = 页面认不出这一行有配置
 * （控件的出现条件是 `ledger.rows.has(rowConfigKey(pkg.name, row.rowId))`）。两者都由
 * [test/settings-seam.test.ts](../../test/settings-seam.test.ts) 从那两个文件里解析后对账 ——
 * 不写死字符串，免得哪天 patch 的 id 改了这个常量悄悄失配。
 */
const BUNDLE_NAME = 'dsh-zhihu-search';

/** bundle patch 里那条 insert 的行 id；改了它必须同改 key，否则卡片静默消失。 */
const ROW_ID = 'dsh-zhihu-search';

/** 交给 `plugins.row.config` 槽的分派 key。 */
const ROW_KEY = `${BUNDLE_NAME}#${ROW_ID}`;

/** 凭据引用名字段，对应 Host 侧 `Config.accessSecretRef`。 */
const REF_FIELD = 'accessSecretRef';

/** 隐藏原生网页搜索开关的字段名，对应 Host 侧 `Config.disableNativeWebSearch`。 */
const HIDE_FIELD = 'disableNativeWebSearch';

/** 拿密钥的地方；与根 README 用的是同一个链接名。 */
const PROFILE_URL = 'https://developer.zhihu.com/profile';

/** 引用名在不被覆盖时的默认值；与 Host 侧 `DEFAULT_ACCESS_SECRET_REF` 一致。 */
const DEFAULT_REF = 'ZHIHU_ACCESS_SECRET';

/**
 * 配置槽的能力探测窗口。
 *
 * 探测的是**能力**不是版本号：版本在插件侧取不到，而「`plugins.row.config` 这个槽在不在」
 * 是当场可观测的事实 —— 槽由插件管理页的浏览器半体声明，缺席时 {@link apply} 里
 * `ctx.slots.inject` 的回调**永远不来**，且宿主不报任何错（静默）。
 *
 * 它盯的是**一个真实故障**，不是「老宿主」：宿主把本插件当成普通 entry 挂载（而不是 bundle 行）时
 * 就没有行、没有 Configure 控件，槽位注册也就无处可落。engine 声明是 advisory，装到旧宿主
 * 不会报错，所以这条提示仍然有活干。
 *
 * 窗口刻意给宽：迟到的声明只多留一条撤销提示，窗口太短反而会打扰正常装配上的用户。
 */
const SLOT_PROBE_TIMEOUT_MS = 10_000;

/**
 * 槽缺席时的提示。英文、`[WARN]` 前缀、无 emoji；落点是**客户端控制台** ——
 * 本插件唯一的界面（这张卡片）就长在缺席的那个槽里，没有跨版本的 UI 面可落。
 */
const SLOT_MISSING_WARNING =
  '[WARN] dsh-zhihu-search: this Host renders no plugins.row.config entry, so the configuration card cannot be shown. The three tools keep working. Mount the plugin as a bundle row (dsh plugin --profile web add) to configure it in place.';

/** 提示必须可撤销：槽迟于窗口才声明时补一条，声明前一条作废。 */
const SLOT_LATE_INFO =
  '[INFO] dsh-zhihu-search: plugins.row.config appeared after the probe window, so the earlier warning is withdrawn and the configuration card is registered.';

/** 框架注入的 `t` 座位类型，绑定到本卡片的字典命名空间。 */
type CardTranslate = TranslateNS<typeof LOCALE_NS>;

/** 本卡片的 section 形状。 */
interface ZhihuSection {
  accessSecretRef?: string;
  disableNativeWebSearch?: boolean;
}

/** 把不透明的 user 层收窄为可查键的对象。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

// 取值逐条对齐官方 PluginConfigForm.module.css 与 fields.module.css：无外框、无圆角、无底色、无内边距 ——
// 一列控件直接铺在插件页的 `data-plugin-config` 区里；没有折叠头（标题与面包屑由插件页自己画）。
const S: Record<string, CSSProperties> = {
  form: { display: 'flex', flexDirection: 'column' },
  readOnly: { margin: '12px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  field: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0' },
  fieldDivider: { display: 'flex', flexDirection: 'column', gap: 6, padding: '12px 0', borderTop: '0.5px solid var(--dsw-alias-border-l2)' },
  head: { display: 'flex', alignItems: 'center', gap: 8 },
  label: { flex: 1, minWidth: 0, fontSize: 13, fontWeight: 500, lineHeight: 1.5, color: 'var(--dsw-alias-label-primary)' },
  badges: { display: 'inline-flex', alignItems: 'center', gap: 8 },
  reset: {
    border: 'none',
    background: 'none',
    padding: 0,
    font: 'inherit',
    fontSize: 12,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-secondary)',
    cursor: 'pointer',
  },
  input: {
    height: 34,
    padding: '0 12px',
    border: '0.5px solid var(--dsw-alias-border-l4)',
    borderRadius: 8,
    background: 'var(--dsw-alias-bg-layer-3)',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-primary)',
    boxSizing: 'border-box',
    width: '100%',
  },
  hint: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  // 开关行：逐条对齐官方 SubagentModelSelectionCard.module.css 的 .toggleRow / .toggleLabel，
  // 右侧放原生 `Switch`（同一个 ui-primitives 包），因此外观与官方卡片一致。
  toggleRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    fontSize: 13,
    lineHeight: 1.5,
    color: 'var(--dsw-alias-label-primary)',
  },
  toggleLabel: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 1.5 },
  // 状态行：比说明行重一档（secondary 对 tertiary），一行说清开关当前的含义。
  stateNote: { margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-secondary)' },
  // 说明句里的外链：只用卡片既有的语义令牌，颜色取自 ui-theme 的 --dsw-alias-link。
  // 卡片是纯内联样式、无法写 :hover，所以常驻下划线作为静态可点提示。
  link: {
    color: 'var(--dsw-alias-link)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  // 原生 .footer：无分割线、无右推 —— 失败文本占满剩余宽度（flex:1），没有失败文本时按钮就靠左。
  footer: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 16,
  },
  // 错误色用有定义的那个令牌：原生照抄来的那一个在 harness 里从未定义，写了不会生效（见 [AGENTS.md](./AGENTS.md)）。
  failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-state-error-primary)' },
  save: {
    appearance: 'none',
    border: '1px solid transparent',
    borderRadius: 8,
    padding: '5px 14px',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
    background: 'var(--dsw-alias-label-primary)',
    color: 'var(--dsw-alias-bg-layer-3)',
  },
};

/** 官方 CSS 的 `:disabled { opacity: .4 }`。 */
function dimStyle(base: CSSProperties, disabled: boolean): CSSProperties {
  return disabled ? { ...base, opacity: 0.4, cursor: 'default' } : base;
}

/**
 * 浏览器计时器没有 `unref`；Node 里有 —— 产物契约测试会在 Node 里求值本模块，
 * 不 unref 就有一条计时器吊着事件循环。有就调，没有就跳过。
 *
 * @param timer - `setTimeout` 的返回值（浏览器是数字，Node 是带 `unref` 的对象）。
 */
function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  const candidate = timer as unknown as { unref?: () => void };
  if (typeof candidate.unref === 'function') candidate.unref();
}

/**
 * 一条字段写入操作。
 *
 * 用**结构类型**就地收窄，不引 `@deepseek-ai/dsh-api-remotes` 的类型边（会为两个字段的形状
 * 多背一个客户端装配包）—— 与 {@link ClientRemoteFace} 同一套做法。
 */
type PathOp = Parameters<ConfigPageForm['mutate']>[0][number];

/** 卡片 props；`t` 由框架按注册时声明的 locale 命名空间注入。 */
interface CardProps {
  /**
   * 宿主为**这一行**算好的表单读写面。页面在渲染期才确定它，而且**可能缺席**。
   *
   * 缺席的成因有两种，表现相同：这一行不在 describe 镜像里（我们那个 entry 没有 volatile
   * 字段、或连接是 memory 模式），或者描述还没回来。缺席时按「不可写」渲染 ——
   * 一个不可配置的宿主与一个还没回来的宿主，对用户是同一件事。
   */
  readonly form: ConfigPageForm | undefined;
  readonly store: ReturnType<typeof createCredentialStore>;
  /** 把当前**生效**的引用名交回 apply —— 卡片是唯一看得到它的地方（`apply` 期 `form` 还不存在）。 */
  readonly trackSavedRef: (ref: string) => void;
  readonly t: CardTranslate;
}

/**
 * 一张配置卡片：字段就地编辑，底部一次性写入。
 *
 * 草稿只活在组件本地状态里 —— 卸载即丢弃（原生表单同款语义），因此没有「放弃」控件；
 * 保存成功同时清空草稿，失败则保留草稿与诊断供修正。
 *
 * **受控，但不订阅表单**：`form.state` 是页面在渲染期取的一份快照（DSH 原文
 * 「refreshed by the page owner」），不是订阅源。保存成功后由页面重渲染把新值推进来 ——
 * `mutate` 会把宿主应答折回镜像（`config-form.ts` 的 `acceptView`）。
 * 所以这里**不要**再引 `useSyncExternalStore` 去订阅表单值。
 *
 * @param props - 这一行的表单面、凭据状态源、引用名回传口，以及框架注入的翻译座位。
 * @returns 卡片元素。
 */
function ZhihuCard({ form, store, trackSavedRef, t }: CardProps): JSX.Element {
  const snapshot = form?.state;
  const section = (snapshot?.value ?? {}) as ZhihuSection;
  const credentialState = useSyncExternalStore(
    (onChange) => store.subscribe(onChange),
    () => store.getSnapshot(),
  );

  const [secret, setSecret] = useState('');
  const [refDraft, setRefDraft] = useState<string | undefined>(undefined);
  const [hideDraft, setHideDraft] = useState<boolean | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');

  const writable = snapshot?.status === 'ready' && snapshot.writable === true;
  const disabled = !writable || saving;
  const effectiveRef = typeof section[REF_FIELD] === 'string' ? section[REF_FIELD] : '';
  const refText = refDraft ?? effectiveRef;
  const refOverridden = asRecord(snapshot?.user)?.[REF_FIELD] !== undefined;
  const refDirty = refText !== effectiveRef;
  const hideEffective = section[HIDE_FIELD] === true;
  const hideText = hideDraft ?? hideEffective;
  const hideDirty = hideDraft !== undefined && hideDraft !== hideEffective;
  const dirty = secret !== '' || refDirty || hideDirty;

  // 状态只对它所描述的那个引用名有效。引用名刚改、状态还没跟上时说「未配置」，
  // 而不是拿上一条记录的答案冒充 —— 徽标说谎比徽标迟到更糟。
  const credential: CredentialView =
    credentialState.ref === effectiveRef ? credentialState : { configured: false, writable: true };
  const secretDisabled = disabled || !credential.writable;
  const blocked = !dirty || disabled;

  // 引用名一变就交回 apply 并重读 —— 徽标描述的是**现实**（配置里存下来的那个名字），
  // 不是编辑中的草稿。只在这里回传：`apply` 拿不到 `form`，卡片是唯一看得到生效值的窗口。
  // 顺序不能换：先交回名字，`store.refresh()` 才问得对。
  useEffect(() => {
    trackSavedRef(effectiveRef === '' ? DEFAULT_REF : effectiveRef);
    void store.refresh();
  }, [effectiveRef, store, trackSavedRef]);

  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed('');
    try {
      // 一次**原子**写：引用名与开关攒成同一批 ops，共用同一个 revision 栅栏。
      // 旧版是两三次独立写入，中间态在界面上可见（引用名已落、开关还没落）。
      const ops: PathOp[] = [];
      if (refDirty) {
        ops.push(refText === '' ? { op: 'unset', path: [REF_FIELD] } : { op: 'set', path: [REF_FIELD], value: refText });
      }
      if (hideDirty) ops.push({ op: 'set', path: [HIDE_FIELD], value: hideText });
      if (ops.length > 0 && form !== undefined) {
        // `mutate` 返回 boolean：false = 宿主拒绝（多半是 revision 冲突），传输错误仍然 reject，
        // 由下面的 catch 一起收口。拒绝必须说出来 —— 悄悄丢弃草稿等于让用户以为保存成功了。
        if (!(await form.mutate(ops, snapshot?.revision))) throw new Error(t('saveRejected'));
      }
      // 空白密钥表示「不修改」：凭据域拒收空值，清空得走 unset，不做成隐式副作用。
      // 凭据写入**排在配置之后**：失败的配置写入不该留下一个指向不存在记录的引用。
      if (secret !== '') await store.write(refText === '' ? DEFAULT_REF : refText, secret);
      setSecret('');
      setRefDraft(undefined);
      setHideDraft(undefined);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={S.form}>
      {/* `form` 缺席（snapshot 也没有）时同样落到这里：读作「不可写」而不是新增一个可见状态，
          语义与旧的 `status === 'unavailable'` 一致。 */}
      {!writable && snapshot?.status !== 'loading'
        ? <p style={S.readOnly} role="status">{t('readOnly')}</p>
        : null}

      <div style={S.field}>
        <div style={S.head}>
          <label style={S.label} htmlFor="zhihu-access-secret">{t('secretLabel')}</label>
          <span style={S.badges}>
            <Tag tone={credential.configured ? 'neutral' : 'quiet'}>
              {credential.configured ? t('secretConfigured') : t('secretMissing')}
            </Tag>
          </span>
        </div>
        <input
          id="zhihu-access-secret"
          style={S.input}
          type="password"
          autoComplete="off"
          value={secret}
          disabled={secretDisabled}
          onChange={(event) => {
            setSecret(event.target.value);
          }}
        />
        <p style={S.hint}>
          {t('secretHintBefore')}
          <a
            style={S.link}
            href={PROFILE_URL}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('secretHintLink')}
          </a>
          {t('secretHintAfter')}
        </p>
        {credential.writable ? null : <p style={S.hint}>{t('secretShadowed')}</p>}
      </div>

      <div style={S.fieldDivider}>
        <div style={S.head}>
          <label style={S.label} htmlFor="zhihu-access-secret-ref">{t('refLabel')}</label>
          {refOverridden
            ? (
              <span style={S.badges}>
                <Tag tone="neutral">{t('refOverridden')}</Tag>
                <button
                  type="button"
                  style={dimStyle(S.reset, disabled)}
                  disabled={disabled}
                  onClick={() => {
                    setRefDraft('');
                  }}
                >
                  {t('reset')}
                </button>
              </span>
            )
            : null}
        </div>
        <input
          id="zhihu-access-secret-ref"
          style={S.input}
          type="text"
          spellCheck={false}
          value={refText}
          disabled={disabled}
          onChange={(event) => {
            setRefDraft(event.target.value);
          }}
        />
        <p style={S.hint}>{t('refHint')}</p>
      </div>

      <div style={S.fieldDivider}>
        <div style={S.toggleRow}>
          <span style={S.toggleLabel}>{t('hideNativeWebLabel')}</span>
          <Switch
            checked={hideText}
            label={t('hideNativeWebLabel')}
            disabled={disabled}
            onChange={(next) => {
              setHideDraft(next);
            }}
          />
        </div>
        {/* 状态行：与官方 SubagentModelSelectionCard 同款写法 —— 拨动即换文案，
            用户不必从开关位置猜它到底做了什么。 */}
        <p style={S.stateNote}>{t(hideText ? 'hideNativeWebOn' : 'hideNativeWebOff')}</p>
        <p style={S.hint}>{t('hideNativeWebHint')}</p>
      </div>

      <div style={S.footer}>
        {failed !== '' ? <p style={S.failed} role="status">{failed}</p> : null}
        <button
          type="button"
          style={dimStyle(S.save, blocked)}
          disabled={blocked}
          onClick={() => {
            void save();
          }}
        >
          {saving ? t('saving') : t('save')}
        </button>
      </div>
    </div>
  );
}

/**
 * 注册配置卡片与它的字典。
 *
 * 槽是插件管理页的 `plugins.row.config`，`key` 是 `<包名>#<行 id>`（见 {@link ROW_KEY}）：
 * 页面按这两个字段寻址某一行的配置，写错即整块不出现。两个视图都要给：
 * - `page` 是卡片本体，渲染在那行 Configure 页的 `data-plugin-config` 区里；
 * - `summary` 是**行缺描述时的回退文案**（DSH `PluginManagerPage.tsx:496`），
 *   而本插件 patch 的行没有 `description`，所以这条一定会被看到。
 *
 * 字典注册进 `ctx.effect`，插件卸载时随之注销（`register` 返回 disposer）。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 */
export function apply(ctx: Context): void {
  const remote = remoteOf(ctx);
  // 读的是**生效**的引用名（配置里存下来的那个），不是编辑中的草稿 ——
  // 徽标描述的是现实，草稿只是表单值。
  //
  // 这个名字只能由卡片回传：`apply` 期拿不到宿主给这一行算的表单面（`form` 是页面在渲染期
  // 才算的）。初值先用默认名，卡片一挂载就会把真实值交回来并触发一次重读。
  let savedRef = DEFAULT_REF;
  const trackSavedRef = (ref: string): void => {
    savedRef = ref;
  };
  const store = createCredentialStore(() => remote.credentials, () => savedRef);

  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, ZHIHU_LOCALES),
    'zhihu-search: card dictionaries',
  );

  // 密钥在别处被写（手改 `.credentials.yaml`、或别的页面写了同名引用）时重读，
  // 否则徽标会一直报告宿主早已替换掉的状态。
  ctx.effect(
    () =>
      remote.$on('credentials/reference-updated', (ref: string) => {
        if (ref === store.getSnapshot().ref) void store.refresh();
      }),
    'zhihu-search: credential refresh on host update',
  );

  // 能力探测：**只新增提示路径**，注册的槽名 / key / 时机一字不动。
  // 状态活在 apply 的闭包里（模块顶层不得有状态），计时器由 ctx.effect 拥有并释放。
  let slotDeclared = false;
  let probeTimer: ReturnType<typeof setTimeout> | undefined;
  let probeWarned = false;

  ctx.effect(() => {
    probeTimer = setTimeout(() => {
      probeTimer = undefined;
      if (slotDeclared) return;
      probeWarned = true;
      console.warn(SLOT_MISSING_WARNING);
    }, SLOT_PROBE_TIMEOUT_MS);
    unrefTimer(probeTimer);
    return () => {
      if (probeTimer !== undefined) clearTimeout(probeTimer);
      probeTimer = undefined;
    };
  }, 'zhihu-search: config slot capability probe');

  ctx.slots.inject('plugins.row.config', () => {
    slotDeclared = true;
    if (probeTimer !== undefined) {
      clearTimeout(probeTimer);
      probeTimer = undefined;
    } else if (probeWarned) {
      // 声明迟到：撤掉那条提示，注册照常。探测失败从不影响主体功能。
      console.info(SLOT_LATE_INFO);
    }
    return ctx.slots.register(
      { name: 'plugins.row.config', key: ROW_KEY, locale: LOCALE_NS },
      (seat: { t: CardTranslate; view: 'summary' | 'page'; form?: ConfigPageForm }) =>
        seat.view === 'page'
          ? <ZhihuCard form={seat.form} store={store} trackSavedRef={trackSavedRef} t={seat.t} />
          : seat.t('rowSummary'),
    );
  });
}
