/**
 * [check-release.mjs](check-release.mjs) 的类型面（手写，理由与 `plugin-metadata.d.mts` 同：
 * 打开 `allowJs` 会把本目录另外几个 `.mjs` 一起拖进 `strict` 的检查面）。
 *
 * **改实现时同批改这里。** 漂了不会静默：`npm run typecheck` 会红。
 */

/**
 * 发布流程里**改写版本号**的命令行（跨仓规则 5b：发布不得 bump，版本驱动）。
 * 只看会执行的命令行 —— YAML 注释与 `echo`（提示语）不算。
 *
 * @param source - 一份 `release.yml` 的文本。
 * @returns 命中的命令行，没命中就是空数组。
 */
export function findVersionWrites(source: string): string[];
