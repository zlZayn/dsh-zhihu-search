/**
 * 浏览器半体：设置 → 插件 → 插件配置 里的「知乎搜索」卡片。
 *
 * 视觉与交互对齐官方插件卡片（`ui-settings-plugins` 的 PluginCard + fields）：
 * 可展开头部（名称 / 说明 / 未保存标记 / 折叠箭头）、字段行（标签 / 状态标记 / 重置）、
 * 底部「放弃 + 保存」，保存成功且 Host 回读确认后才折叠。
 *
 * 文案全部走 DSH 的 locale 服务（`ctx.locale`），不硬编码 —— 字典在 [locales.ts](./locales.ts)，
 * 注册时用 `locale:` 声明命名空间，框架据此把类型化的 `t` 座位注入组件 props。
 * 切语言无需重挂载：字典注册会推进 locale 版本号，已挂载的出口自动重取。
 *
 * 复用 `@deepseek-ai/dsh-client-ui-primitives` 的 `Tag` 与折叠图标：那是公共基础库，
 * 不是别的插件 —— 被 bundle-purity gate 禁止的是跨插件值导入。
 * 其余控件按官方 CSS 自带样式，取值只用 `--dsw-alias-*` 语义令牌。
 *
 * 数据层契约完全由 Host 侧承担（`installSection` + `role('secret')`）。
 */

import { useState, useSyncExternalStore, type CSSProperties } from 'react';
import { IconChevronDownOutline14, Tag } from '@deepseek-ai/dsh-client-ui-primitives';
import type { Context } from '@deepseek-ai/cordis';
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots';
import type {} from '@deepseek-ai/dsh-client-ui-settings/client';
import type { SettingsDescribeFace, SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client';
// 类型导入即声明：`ctx.locale` 由 locale 包的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-locale/client';
// 类型导入即声明：ctx.slots 由 ui-renderer 的浏览器半体合并进 Context。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client';
import { LOCALE_NS, ZHIHU_LOCALES } from './locales.js';

/**
 * 依赖的浏览器端服务。
 *
 * `locale` 是硬依赖：注册时声明了 `locale:`，渲染就需要已安装的 locale 面，
 * 缺席时 DSH 会直接报错而不是降级。标准 web 装配必然带它
 * （DSH `packages/bundle/web-app` 依赖 `dsh-client-locale`）。
 */
export const inject = ['slots', 'settingsScope', 'locale'];

/** 与 Host 侧 `ZHIHU_SETTINGS_NAMESPACE` 逐字一致；它就是卡片的分派 key。 */
const NAMESPACE = 'zhihu-search';

/** 承载密钥的字段名，对应 Host 侧 `Config.accessSecret`。 */
const SECRET_FIELD = 'accessSecret';

/** 凭据引用名字段，对应 Host 侧 `Config.accessSecretRef`。 */
const REF_FIELD = 'accessSecretRef';

/** 拿密钥的地方；与根 README 用的是同一个链接名。 */
const PROFILE_URL = 'https://developer.zhihu.com/profile';

/** 框架注入的 `t` 座位类型，绑定到本卡片的字典命名空间。 */
type CardTranslate = TranslateNS<typeof LOCALE_NS>;

/** 本卡片的 section 形状。 */
interface ZhihuSection {
  accessSecret?: string;
  accessSecretRef?: string;
}

/** 把不透明的 user 层收窄为可查键的对象。 */
function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
}

/**
 * 判断密钥槽位是否已有值。
 *
 * 用线路上的 `secrets` 记录而不是 `value`/`user`：密钥字段在服务端就被剥离
 * （DSH `settings/src/redact.ts`），三个值里都读不到它；只有 `secrets[].set`
 * 保留了「这个槽位有没有值」这个事实。
 *
 * @param mirror - 设置描述镜像。
 * @returns 该槽位是否已有值。
 */
export function readConfigured(mirror: SettingsDescribeFace): boolean {
  const view = mirror.getSnapshot().view?.namespaces.find((row) => row.ns === NAMESPACE);
  const slot = view?.secrets?.find(
    (entry: { readonly path: readonly string[]; readonly set: boolean }) =>
      entry.path.length === 1 && entry.path[0] === SECRET_FIELD,
  );
  return slot?.set === true;
}

// 取值逐条对齐官方 PluginCard.module.css 与 fields.module.css。
const S: Record<string, CSSProperties> = {
  card: {
    listStyle: 'none',
    border: '0.5px solid var(--dsw-alias-border-l4)',
    borderRadius: 16,
    background: 'var(--dsw-alias-bg-layer-3)',
    transition: 'border-color .16s, background .16s',
  },
  cardOpen: {
    listStyle: 'none',
    border: '0.5px solid var(--dsw-alias-label-dimmed)',
    borderRadius: 16,
    background: 'var(--dsw-alias-bg-layer-2)',
    transition: 'border-color .16s, background .16s',
  },
  header: {
    width: '100%',
    appearance: 'none',
    border: 0,
    background: 'none',
    font: 'inherit',
    color: 'inherit',
    textAlign: 'left',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    borderRadius: 12,
  },
  headText: { flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 },
  name: { fontSize: 15, fontWeight: 600, lineHeight: 1.4, color: 'var(--dsw-alias-label-primary)' },
  description: { fontSize: 13, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)' },
  chevron: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transition: 'transform .16s' },
  chevronOpen: { flex: 'none', color: 'var(--dsw-alias-label-tertiary)', transform: 'rotate(180deg)', transition: 'transform .16s' },
  body: { borderTop: '0.5px solid var(--dsw-alias-border-l2)', margin: '0 16px', paddingBottom: 8 },
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
  // 说明句里的外链：只用卡片既有的语义令牌，颜色取自 ui-theme 的 --dsw-alias-link。
  // 卡片是纯内联样式、无法写 :hover，所以常驻下划线作为静态可点提示。
  link: {
    color: 'var(--dsw-alias-link)',
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 8,
    padding: '12px 0 4px',
    borderTop: '0.5px solid var(--dsw-alias-border-l2)',
  },
  failed: { flex: 1, minWidth: 0, margin: 0, fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-error)' },
  discard: {
    appearance: 'none',
    border: '1px solid var(--dsw-alias-border-l2)',
    borderRadius: 8,
    padding: '5px 14px',
    font: 'inherit',
    fontSize: 13,
    lineHeight: 1.5,
    cursor: 'pointer',
    background: 'none',
    color: 'var(--dsw-alias-label-secondary)',
  },
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

/** 卡片 props；`t` 由框架按注册时声明的 locale 命名空间注入。 */
interface CardProps {
  readonly scope: SettingsScope<ZhihuSection>;
  readonly mirror: SettingsDescribeFace;
  readonly t: CardTranslate;
}

/**
 * 一张插件卡片：头部可展开，字段在展开处就地编辑，底部一次性写入。
 *
 * 草稿跨折叠保留，因此头部标记「未保存」；保存成功后才折叠，
 * 失败则保持展开并保留草稿与诊断供修正。
 *
 * @param props - 命名空间作用域、描述镜像，以及框架注入的翻译座位。
 * @returns 卡片元素。
 */
function ZhihuCard({ scope, mirror, t }: CardProps): JSX.Element {
  const snapshot: SettingsScopeSnapshot<ZhihuSection> = useSyncExternalStore(
    (onChange) => scope.subscribe(onChange),
    () => scope.getSnapshot(),
  );
  const configured = useSyncExternalStore(
    (onChange) => mirror.subscribe(onChange),
    () => readConfigured(mirror),
  );

  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState('');
  const [refDraft, setRefDraft] = useState<string | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState('');

  const writable = snapshot.writable && snapshot.status === 'ready';
  const disabled = !writable || saving;
  const effectiveRef = typeof snapshot.value?.[REF_FIELD] === 'string' ? snapshot.value[REF_FIELD] : '';
  const refText = refDraft ?? effectiveRef;
  const refOverridden = asRecord(snapshot.user)?.[REF_FIELD] !== undefined;
  const refDirty = refText !== effectiveRef;
  const dirty = secret !== '' || refDirty;
  const blocked = !dirty || disabled;

  const discard = (): void => {
    setSecret('');
    setRefDraft(undefined);
    setFailed('');
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setFailed('');
    try {
      // 空白密钥表示「不修改」，因此跳过写入 —— 否则会把已存的密钥清成空串。
      if (secret !== '') await scope.set(SECRET_FIELD, secret);
      if (refDirty) {
        if (refText === '') await scope.unset(REF_FIELD);
        else await scope.set(REF_FIELD, refText);
      }
      setSecret('');
      setRefDraft(undefined);
      setOpen(false);
    } catch (error) {
      setFailed(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  return (
    <li style={open ? S.cardOpen : S.card}>
      <button
        type="button"
        style={S.header}
        aria-expanded={open}
        onClick={() => {
          setOpen(!open);
        }}
      >
        <span style={S.headText}>
          <span style={S.name}>{t('title')}</span>
          <span style={S.description}>{t('description')}</span>
        </span>
        {dirty ? <Tag tone="neutral">{t('unsaved')}</Tag> : null}
        <span style={open ? S.chevronOpen : S.chevron}>
          <IconChevronDownOutline14 />
        </span>
      </button>

      {open
        ? (
          <div style={S.body}>
            {!writable && snapshot.status !== 'loading'
              ? <p style={S.readOnly} role="status">{t('readOnly')}</p>
              : null}

            <div style={S.field}>
              <div style={S.head}>
                <label style={S.label} htmlFor="zhihu-access-secret">{t('secretLabel')}</label>
                <span style={S.badges}>
                  <Tag tone={configured ? 'neutral' : 'quiet'}>
                    {configured ? t('secretConfigured') : t('secretMissing')}
                  </Tag>
                </span>
              </div>
              <input
                id="zhihu-access-secret"
                style={S.input}
                type="password"
                autoComplete="off"
                value={secret}
                disabled={disabled}
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

            <div style={S.footer}>
              {failed !== '' ? <p style={S.failed} role="status">{failed}</p> : null}
              <button type="button" style={dimStyle(S.discard, !dirty || saving)} disabled={!dirty || saving} onClick={discard}>
                {t('discard')}
              </button>
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
        )
        : null}
    </li>
  );
}

/**
 * 注册设置卡片与它的字典。
 *
 * `key` 必须等于命名空间：面板正是按这个 key 决定分派哪些卡片。
 * 字典注册进 `ctx.effect`，插件卸载时随之注销（`register` 返回 disposer）。
 *
 * @param ctx - 浏览器端 Cordis 上下文。
 */
export function apply(ctx: Context): void {
  const scope = ctx.settingsScope.bind<ZhihuSection>({ namespace: NAMESPACE });
  const mirror = ctx.settingsScope.describe();

  ctx.effect(
    () => ctx.locale.register(LOCALE_NS, ZHIHU_LOCALES),
    'zhihu-search: card dictionaries',
  );

  ctx.slots.inject('settings.plugin.item', () =>
    ctx.slots.register(
      { name: 'settings.plugin.item', key: NAMESPACE, locale: LOCALE_NS },
      (seat: { t: CardTranslate }) => <ZhihuCard scope={scope} mirror={mirror} t={seat.t} />,
    ),
  );
}
