/**
 * 直答（zhida）的呈现层 —— 纯函数，无运行时依赖。
 *
 * ⚠ 刻意**不声明 `presentationMeta`**：
 * 直答的答案就是模型可见文本本身，再往 meta 里复制一份会让会话日志
 * 的体积翻倍（思维链尤其长），而 UI 拿不到任何额外信息。
 * 只有「Markdown 无法无损承载」的结构（如搜索来源列表）才值得走 meta。
 */

import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import type { GenericCallView, GenericResultView, ToolResult } from '@deepseek-ai/dsh-tools';
import type { ZhidaOutput } from '../types.js';
import { errorBlock } from './error-block.js';

/**
 * 渲染模型可见的 Markdown。
 *
 * 思维链默认**不进**模型上下文：它会让每轮对话的 token 成本翻数倍，
 * 而模型自己已经能从上文推断。仅在 `includeReasoning` 时才附上。
 *
 * @param value - 工具的 Canonical Output。
 * @param includeReasoning - 是否把思维链一并交给模型。
 * @returns 单个文本块。
 */
export function renderZhida(value: ZhidaOutput, includeReasoning = false): ContentBlock[] {
  if (!value.ok) return errorBlock('知乎直答失败', value.error);

  const parts: string[] = [];
  parts.push(`**知乎直答（${value.model}）**`, '');
  if (includeReasoning && value.reasoning !== '') {
    parts.push('> 推理过程：', `> ${value.reasoning.replace(/\n/g, '\n> ')}`, '');
  }
  parts.push(value.answer, '', `> 来源：知乎直答 · 问题：${value.question}`);
  return [{ type: 'text', text: parts.join('\n') }];
}

/**
 * 待执行态的卡片。
 *
 * @param args - 已校验的工具参数。
 * @returns 通用卡片。
 */
export function presentZhidaCall(args: { readonly question: string }): GenericCallView {
  return { card: 'generic', title: `知乎直答：${args.question}`, kind: 'fetch' };
}

/**
 * 完成态卡片。
 *
 * 只替换标题，内容交给 UI 渲染原始结果 —— 理由见文件头注释。
 *
 * @param args - 已校验的工具参数。
 * @param result - 模型可见的最终结果。
 * @returns 通用结果卡片，或 `undefined` 交回 UI 降级。
 */
export function presentZhidaResult(
  args: { readonly question: string },
  result: ToolResult,
): GenericResultView | undefined {
  if (result.isError) return { card: 'generic', title: `知乎直答失败：${args.question}` };
  return { card: 'generic', title: `知乎直答：${args.question}` };
}
