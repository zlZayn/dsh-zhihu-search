/**
 * 失败分支的模型可见文本 —— 搜索与直答共用。
 *
 * 两处原本逐字重复（`❌ <前缀>：<message>` 加一段可选的 `hint`），
 * 只有前缀文案不同。收敛在这里，改措辞只需改一处。
 *
 * ⚠ 与同目录其它模块一样**没有运行时依赖**：两个 import 都是纯类型，编译期即擦除。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { CanonicalError } from '../utils/errors.js';

/**
 * 渲染失败分支的单个文本块。
 *
 * `message` 缺失时退化成「未知错误」：Canonical Output 可能来自旧版本会话日志，
 * 形状不保证齐全 —— 宁可给出笼统文案，也不在回放时抛错。
 * `hint` 缺失或为空串时整段省略（与其它渲染规则一致：不适用就省略，不留空行）。
 *
 * @param prefix - 失败动作的短名，如 `搜索失败`、`知乎直答失败`。
 * @param error - Canonical Output 的 `error` 字段。
 * @returns 单个文本块。
 */
export function errorBlock(prefix: string, error: CanonicalError | undefined): ContentBlock[] {
  const lines = [`❌ ${prefix}：${error?.message ?? '未知错误'}`];
  if (error?.hint !== undefined && error.hint !== '') lines.push(error.hint);
  return [{ type: 'text', text: lines.join('\n') }];
}
