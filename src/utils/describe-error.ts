/**
 * 异常 → 一行文本。
 *
 * **为什么单独成叶子、而不是并进 `errors.ts`**：`errors.ts` 值导入 `transport.ts` /
 * `state.ts` / `compiler.ts` 取错误类做 `instanceof` 判定（见其文件头注释），
 * 于是 `transport.ts` 反向复用 `errors.ts` 会成环 —— 违反架构文档「依赖单向流动」。
 * 本模块**零导入**，任何模块（含最上游的 `transport.ts`）都能安全依赖它。
 *
 * ⚠ 与 `utils/` 其它模块同规矩：**禁止运行时 import `@deepseek-ai/*`**，类型一律 `import type`。
 */

/**
 * 把任意抛出的值压成一行文本，供日志与错误消息使用。
 *
 * 只取 `Error.message`；非 `Error` 的抛出值退回 `String()`。
 * **绝不带凭据**：上游约定异常文本里不含密钥，所以它可以安全写进日志。
 *
 * @param error - 任意抛出的值。
 * @returns 单行错误文本。
 */
export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
