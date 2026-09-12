/**
 * 错误 → Canonical Error 的映射。
 *
 * 为什么集中在这里：工具契约要求 `execute` **绝不 throw**，
 * 而错误分类（`kind`）是模型判断「该不该换个做法重试」的唯一依据。
 * 散落在各工具里的 try/catch 迟早会漏分支，漏掉的那个会以「未知错误」暴露给模型。
 */

import { ZhihuClientError } from '../transport.js';
import { CompileError } from './compiler.js';
import { LocalRateLimitError } from '../state.js';

/** 工具 Canonical Output 里的错误结构。 */
export interface CanonicalError {
  /** 机器可判别的错误种类。 */
  readonly kind: string;
  /** 面向模型的一句话说明。 */
  readonly message: string;
  /** 可选的补救建议；只在「模型能据此换个做法」时才给。 */
  readonly hint?: string;
}

/**
 * 把任意异常收敛为 Canonical Error。
 *
 * 本函数**必须永不抛出**：它在 `catch` 块里运行，
 * 若它自己抛错，工具就会破坏「绝不 throw」的契约并让整个 DSH 调用失败。
 *
 * @param error - 任意被捕获的值。
 * @returns 稳定的错误结构。
 */
export function mapError(error: unknown): CanonicalError {
  try {
    if (error instanceof ZhihuClientError) {
      return {
        kind: error.kind,
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      };
    }
    if (error instanceof CompileError) {
      return {
        kind: 'param',
        message: error.message,
        ...(error.hint === undefined ? {} : { hint: error.hint }),
      };
    }
    if (error instanceof LocalRateLimitError) {
      const seconds = Math.ceil(error.retryAfterMs / 1000);
      return {
        kind: 'local_rate_limit',
        message: error.message,
        hint: `这是本地频率保护，未消耗任何知乎额度。请等待约 ${String(seconds)} 秒后重试。`,
      };
    }
    if (error instanceof Error) {
      return { kind: 'unknown', message: error.message };
    }
    return { kind: 'unknown', message: String(error) };
  } catch (mapperFailure) {
    // 连 mapError 都失败时，仍然要给出一个合法结构而不是抛出。
    return { kind: 'unknown', message: `错误映射自身失败：${String(mapperFailure)}` };
  }
}
