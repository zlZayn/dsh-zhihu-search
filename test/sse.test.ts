/**
 * SSE 解析测试。
 *
 * 最核心的一条是「汉字被按字节切断」：这是原生 fetch 流式解析的真实故障模式，
 * 而且偶发，靠人工测试几乎抓不到。这里把它钉死成回归守卫。
 */

import { describe, expect, it } from 'vitest';
import { deltaFromPayload, parseSSEStream } from '../src/transport.js';

/** 用任意字符串片段构造一个字节流。 */
function streamOf(chunks: ReadonlyArray<string | Uint8Array>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
}

/** 收齐全部载荷。 */
async function collect(stream: ReadableStream<Uint8Array>): Promise<string[]> {
  const payloads: string[] = [];
  for await (const payload of parseSSEStream(stream)) payloads.push(payload);
  return payloads;
}

describe('parseSSEStream', () => {
  it('把跨 chunk 的 JSON 拼回完整事件', async () => {
    const payloads = await collect(streamOf(['data: {"con', 'tent": "hello"}\n\n']));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0] ?? '')).toMatchObject({ content: 'hello' });
  });

  it('多字节 UTF-8 字符被按字节切断时不解出乱码', async () => {
    const encoder = new TextEncoder();
    const bytes = encoder.encode('data: {"content": "中文回答"}\n\n');
    // 'data: {"content": "' 是 19 个 ASCII 字节，紧跟的「中」占 3 字节，
    // 从第 20 字节切开会把它劈成两半。
    const cut = 19 + 1;
    const payloads = await collect(streamOf([bytes.slice(0, cut), bytes.slice(cut)]));
    expect(payloads).toHaveLength(1);
    expect(JSON.parse(payloads[0] ?? '')).toMatchObject({ content: '中文回答' });
    expect(payloads[0]).not.toContain('\uFFFD');
  });

  it('事件分隔符自身被切断也能恢复', async () => {
    const payloads = await collect(streamOf(['data: {"content":"a"}\n', '\ndata: {"content":"b"}\n\n']));
    expect(payloads).toHaveLength(2);
    expect(JSON.parse(payloads[1] ?? '')).toMatchObject({ content: 'b' });
  });

  it('忽略以冒号开头的心跳注释', async () => {
    const payloads = await collect(streamOf([': keep-alive\n\n', 'data: {"content":"x"}\n\n']));
    expect(payloads).toHaveLength(1);
  });

  it('遇到 [DONE] 立即结束，不再消费后续数据', async () => {
    const payloads = await collect(
      streamOf(['data: {"content":"x"}\n\n', 'data: [DONE]\n\n', 'data: {"content":"after"}\n\n']),
    );
    expect(payloads).toHaveLength(1);
  });

  it('兼容 CRLF 分隔符', async () => {
    const payloads = await collect(streamOf(['data: {"content":"crlf"}\r\n\r\n']));
    expect(payloads).toHaveLength(1);
  });

  it('兼容 data: 后无空格', async () => {
    const payloads = await collect(streamOf(['data:{"content":"nospace"}\n\n']));
    expect(payloads).toHaveLength(1);
  });
});

describe('deltaFromPayload', () => {
  it('把 reasoning_content 与 content 分开提取', () => {
    expect(deltaFromPayload('{"choices":[{"delta":{"reasoning_content":"想"}}]}')).toEqual({ reasoningContent: '想' });
    expect(deltaFromPayload('{"choices":[{"delta":{"content":"答"}}]}')).toEqual({ content: '答' });
  });

  it('对畸形载荷返回 undefined 而不是抛错', () => {
    for (const bad of ['not json', '', '{}', '{"choices":[]}', '{"choices":[{}]}', 'null']) {
      expect(() => deltaFromPayload(bad)).not.toThrow();
      expect(deltaFromPayload(bad)).toBeUndefined();
    }
  });
});
