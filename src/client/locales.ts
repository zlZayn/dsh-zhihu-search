/**
 * 卡片文案字典。
 *
 * 与官方 `ui-settings-plugins/src/client/locales.ts` 同构：命名空间合并进
 * `LocaleNamespaceMap`，key 因此有类型约束 —— 拼错或漏译都是编译错误，
 * 而不是运行时的空白。
 *
 * 两种语言必须同时给全：`ctx.locale.register` 的 typed 形态要求
 * `Record<BuiltInLocaleId, LocaleDictOf<N>>`（DSH locale/src/client/index.ts:370），
 * 缺一种即编译失败。这正是我们要的 —— 双语平衡由编译器守，不靠自觉。
 */

import type { LocaleNamespaceMap } from '@deepseek-ai/dsh-client-ui-slots';

/**
 * 字典命名空间。
 *
 * 与卡片的分派 key 同名但是两件事：分派 key 是 Host 侧设置命名空间，
 * 这个命名空间只标识本卡片的文案归属。
 */
export const LOCALE_NS = 'zhihu-search';

/** 本卡片全部文案的 key。 */
export type ZhihuLocaleKey =
  | 'title'
  | 'description'
  | 'unsaved'
  | 'readOnly'
  | 'secretLabel'
  | 'secretConfigured'
  | 'secretMissing'
  | 'secretHintBefore'
  | 'secretHintLink'
  | 'secretHintAfter'
  | 'refLabel'
  | 'refOverridden'
  | 'reset'
  | 'refHint'
  | 'discard'
  | 'save'
  | 'saving';

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'zhihu-search': ZhihuLocaleKey;
  }
}

/** 简体中文文案。 */
const zh: Record<ZhihuLocaleKey, string> = {
  title: '知乎搜索',
  description: '知乎开放平台的站内检索、全网检索与直答工具。',
  unsaved: '未保存',
  readOnly: '当前连接不允许写入设置。',
  secretLabel: 'Access Secret',
  secretConfigured: '已配置',
  secretMissing: '未配置',
  secretHintBefore: '在',
  secretHintLink: '知乎开放平台个人中心',
  secretHintAfter: '获取；留空则不修改已保存的密钥。',
  refLabel: '凭据引用名',
  refOverridden: '已覆盖',
  reset: '重置',
  refHint: '环境变量或凭据记录的名字；留空并保存会清掉覆盖，回落到默认的 ZHIHU_ACCESS_SECRET。',
  discard: '放弃',
  save: '保存',
  saving: '保存中…',
};

/** English copy. */
const en: Record<ZhihuLocaleKey, string> = {
  title: 'Zhihu Search',
  description: 'In-site search, global index search and Zhida over the Zhihu Open Platform API.',
  unsaved: 'Unsaved',
  readOnly: 'This connection does not allow writing settings.',
  secretLabel: 'Access Secret',
  secretConfigured: 'Configured',
  secretMissing: 'Not configured',
  secretHintBefore: 'Get yours at the ',
  secretHintLink: 'Zhihu Open Platform profile',
  secretHintAfter: '. Leaving this blank keeps the saved secret.',
  refLabel: 'Credential reference',
  refOverridden: 'Overridden',
  reset: 'Reset',
  refHint: 'Name of an environment variable or credential record. Saving it blank clears the override and falls back to ZHIHU_ACCESS_SECRET.',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
};

/** 交给 `ctx.locale.register` 的双语字典。 */
export const ZHIHU_LOCALES: Record<'zh' | 'en', Record<ZhihuLocaleKey, string>> = { zh, en };

/** 供上层复用的命名空间表类型。 */
export type { LocaleNamespaceMap };
