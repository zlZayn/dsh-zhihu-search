/**
 * `zhihu_zhida` —— 知乎直答（对话 / 生成）工具。
 *
 * 它是本项目里唯一走 SSE 的工具：知乎直答以 `text/event-stream` 流式返回，
 * 且会先输出 `reasoning_content` 再输出 `content`。两者在客户端分开累加，
 * 由本工具决定是否把思维链交给模型。
 *
 * 模型只传语义化档位（fast / thinking / agent），真实模型 id 由本模块映射（红线 5）。
 */

import { defineTool, type ToolDefinition } from '@deepseek-ai/dsh-tools';
import { CompileError } from '../utils/compiler.js';
import { mapError } from '../utils/errors.js';
import { LocalRateLimitError } from '../state.js';
import { presentZhidaCall, presentZhidaResult, renderZhida } from '../present/zhida.js';
import type { ZhidaOutput } from '../types.js';
import { cacheKeyFor, type ToolDeps } from './deps.js';

/** 工具名。 */
export const ZHIHU_ZHIDA_TOOL = 'zhihu_zhida';

/** 语义化档位 → 知乎真实模型 id。 */
const ZHIDA_MODEL_MAP = {
  fast: 'zhida-fast-1p5',
  thinking: 'zhida-thinking-1p5',
  agent: 'zhida-agent',
} as const;

/** 档位的模型可见取值。 */
const ZHIDA_MODELS = ['fast', 'thinking', 'agent'] as const;

/** 直答是流式生成，预算必须显著宽于搜索。 */
const TIMEOUT_MS = 60_000;

/**
 * 构造 `zhihu_zhida` 工具。
 *
 * @param deps - 运行期依赖。
 * @returns 可直接注册的工具定义。
 */
export function createZhihuZhidaTool(deps: ToolDeps): ToolDefinition {
  return defineTool({
    name: ZHIHU_ZHIDA_TOOL,
    description:
      '知乎直答：由知乎生成一段成体系的综合回答，适合需要「先检索再总结」的问题。' +
      '与两个搜索工具的区别：搜索返回可点开的来源列表，直答返回一段成体系的回答——要来源用搜索，要解释用直答。' +
      '答案由知乎生成，可能有误，重要结论请自行核对。',

    parameters: {
      question: { type: 'string', required: true, description: '要提问的问题，中文描述越具体越好。' },
      mode: {
        type: 'string',
        enum: ZHIDA_MODELS,
        description: '回答档位：fast 快速回答，thinking 深度思考，agent 智能体多步检索。默认 thinking。',
        default: 'thinking',
      },
      includeReasoning: {
        type: 'boolean',
        description: '是否把推理过程一并返回。默认 false 以节省上下文；排查答案可靠性时可开启。',
        default: false,
      },
    },

    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ok: { type: 'boolean', required: true },
          question: { type: 'string', required: true },
          model: { type: 'string', required: true },
          answer: { type: 'string', required: true },
          reasoning: { type: 'string', required: true },
          error: {
            type: 'object',
            additionalProperties: false,
            properties: {
              kind: { type: 'string', required: true },
              message: { type: 'string', required: true },
              hint: { type: 'string' },
            },
          },
        },
      },
      // render 读取 Canonical Output：是否携带思维链是**数据决定的**，
      // 因此把 includeReasoning 的结果固化进 reasoning 字段，render 依据它判断。
      render: (args, value) => renderZhida(value, args.includeReasoning ?? false),
    },

    timeoutMs: TIMEOUT_MS,
    // 无父级状态，可并行；但本地令牌桶会限制实际并发。
    isConcurrencySafe: () => true,
    presentCall: (args) => presentZhidaCall(args),
    presentResult: (args, result) => presentZhidaResult(args, result),

    async execute(args, exec) {
      const question = args.question.trim();
      const mode = args.mode ?? 'thinking';
      const model = ZHIDA_MODEL_MAP[mode];

      try {
        if (question === '') throw new CompileError('问题不能为空。');
        if (model === undefined) throw new CompileError(`不支持的档位：${String(mode)}`, `可用档位：${ZHIDA_MODELS.join(' / ')}`);

        const includeReasoning = args.includeReasoning ?? false;
        // 缓存键必须含档位：不同档位的答案不同，共用键会返回错误的档位结果。
        const key = cacheKeyFor(deps, ZHIHU_ZHIDA_TOOL, { question, model });

        const cached = deps.cache.get(key);
        if (cached !== undefined) {
          // 命中缓存时按本次请求的 includeReasoning 决定是否回吐思维链。
          const hit = cached as ZhidaOutput;
          return { ...hit, reasoning: includeReasoning ? hit.reasoning : '' };
        }

        if (!deps.zhidaBucket.tryConsume()) {
          throw new LocalRateLimitError(
            '本地频率限制：直答请求超过每分钟上限。',
            deps.zhidaBucket.retryAfterMs(),
          );
        }

        const result = await deps.client.chat(
          { model, messages: [{ role: 'user', content: question }] },
          exec.signal,
        );

        if (result.content.trim() === '') {
          throw new CompileError('知乎直答返回了空答案。', '可能是该档位当前不可用，请换一个档位重试。');
        }

        // 完整结果进缓存（含思维链），是否展示由命中方决定。
        const stored: ZhidaOutput = {
          ok: true,
          question,
          model,
          answer: result.content,
          reasoning: result.reasoningContent,
        };
        deps.cache.set(key, stored);

        return { ...stored, reasoning: includeReasoning ? stored.reasoning : '' };
      } catch (error) {
        return { ok: false, question, model: model ?? '', answer: '', reasoning: '', error: mapError(error) };
      }
    },
  });
}
