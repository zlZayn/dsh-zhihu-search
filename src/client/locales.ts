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
  | 'secretShadowed'
  | 'refLabel'
  | 'refOverridden'
  | 'reset'
  | 'refHint'
  | 'hideNativeWebLabel'
  | 'hideNativeWebOn'
  | 'hideNativeWebOff'
  | 'hideNativeWebHint'
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
  secretHintAfter: '获取。密钥存入凭据存储，不写进设置文件；留空则不修改已保存的密钥。',
  secretShadowed: '该引用名由只读来源（如进程环境变量）提供，无法在这里覆盖。',
  refLabel: '凭据引用名',
  refOverridden: '已覆盖',
  reset: '重置',
  refHint: '环境变量或凭据记录的名字；留空并保存会清掉覆盖，回落到默认的 ZHIHU_ACCESS_SECRET。',
  hideNativeWebLabel: '隐藏原生网页搜索（web_search / web_fetch）',
  hideNativeWebOn: '模型只看得到知乎的三个工具。',
  hideNativeWebOff: '原生网页搜索对模型可见。',
  hideNativeWebHint: '仅控制模型可见性，不影响 tool-web 插件本身状态；保存后从下一次模型请求起生效，无需重启。',
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
  secretHintAfter: '. The key is stored in the credential store, never in the settings file; leaving this blank keeps the saved secret.',
  secretShadowed: 'A read-only source (such as a process environment variable) supplies this reference; it cannot be overridden here.',
  refLabel: 'Credential reference',
  refOverridden: 'Overridden',
  reset: 'Reset',
  refHint: 'Name of an environment variable or credential record. Saving it blank clears the override and falls back to ZHIHU_ACCESS_SECRET.',
  hideNativeWebLabel: 'Hide native web search (web_search / web_fetch)',
  hideNativeWebOn: 'The model sees only the three Zhihu tools.',
  hideNativeWebOff: 'Native web search stays visible to the model.',
  hideNativeWebHint: 'Visibility only — the tool-web plugin itself is untouched. Applies from the next model request after saving; no restart needed.',
  discard: 'Discard',
  save: 'Save',
  saving: 'Saving…',
};

/** 交给 `ctx.locale.register` 的双语字典。 */
export const ZHIHU_LOCALES: Record<'zh' | 'en', Record<ZhihuLocaleKey, string>> = { zh, en };

/** 供上层复用的命名空间表类型。 */
export type { LocaleNamespaceMap };
