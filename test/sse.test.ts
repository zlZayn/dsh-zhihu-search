/**
 * SSE 解析测试。
 *
 * 最核心的一条是「汉字被按字节切断」：这是原生 fetch 流式解析的真实故障模式，
 * 而且偶发，靠人工测试几乎抓不到。这里把它钉死成回归守卫。
 */

import { describe, expect, it, vi } from 'vitest';
import { ZhihuClient, ZhihuClientError, deltaFromPayload, parseSSEStream } from '../src/transport.js';

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

  it('提取 finish_reason，正常结束不产生错误', () => {
    expect(deltaFromPayload('{"choices":[{"delta":{},"finish_reason":"stop"}]}')).toEqual({ finishReason: 'stop' });
  });

  it('官方文档的中途失败帧解析为带分类的错误，而不是被当成空增量丢掉', () => {
    const payload = JSON.stringify({
      id: 'chatcmpl-x',
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: {}, finish_reason: 'error' }],
      error: { message: 'Internal server error', type: 'server_error', code: 'internal_error' },
    });
    const chunk = deltaFromPayload(payload);
    expect(chunk?.error).toBeInstanceOf(ZhihuClientError);
    expect(chunk?.error?.kind).toBe('server');
    expect(chunk?.finishReason).toBe('error');
  });

  it('只有 finish_reason=error、没有 error 体时也判失败', () => {
    expect(deltaFromPayload('{"choices":[{"delta":{},"finish_reason":"error"}]}')?.error?.kind).toBe('server');
  });
});

describe('ZhihuClient.chat —— 流生命周期', () => {
  const sseHeaders = { 'content-type': 'text/event-stream' };
  const request = { model: 'zhida-thinking-1p5', messages: [{ role: 'user', content: 'q' }] };

  /** 构造一个「响应头立刻返回、响应体受 signal 控制」的 fetch 替身，模拟真实 fetch 的中止语义。 */
  function streamingFetch(): typeof fetch {
    return (async (_input: string, init?: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init?.signal?.addEventListener('abort', () => {
            // 真实 fetch 以 abort 原因（reason）拒绝响应体，这里如实复刻。
            controller.error(init.signal?.reason ?? new DOMException('aborted', 'AbortError'));
          });
        },
      });
      return new Response(body, { status: 200, headers: sseHeaders });
    }) as unknown as typeof fetch;
  }

  it('中途失败帧让整轮失败，而不是交付半截答案', async () => {
    const body = [
      'data: {"choices":[{"delta":{"content":"前半段"}}]}\n\n',
      'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"Internal server error","type":"server_error","code":"internal_error"}}\n\n',
      'data: [DONE]\n\n',
    ].join('');
    const client = new ZhihuClient({
      accessSecret: 's',
      baseUrl: 'https://example.test',
      fetchImpl: (async () => new Response(body, { status: 200, headers: sseHeaders })) as unknown as typeof fetch,
    });
    await expect(client.chat(request)).rejects.toMatchObject({ kind: 'server' });
  });

  it('响应头之后调用方取消仍能中断读取', async () => {
    const controller = new AbortController();
    const client = new ZhihuClient({ accessSecret: 's', baseUrl: 'https://example.test', fetchImpl: streamingFetch() });
    const pending = client.chat(request, controller.signal);
    setTimeout(() => controller.abort(), 30);
    await expect(pending).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('仍在推进的流不会被配置里的短请求超时切掉（流式预算独立）', async () => {
    const encoder = new TextEncoder();
    const client = new ZhihuClient({
      accessSecret: 's',
      baseUrl: 'https://example.test',
      // 搜索用 40ms；若流式也用这个值，下面的流必然被切。
      timeoutMs: 40,
      fetchImpl: (async () => {
        const body = new ReadableStream<Uint8Array>({
          async start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"答"}}]}\n\n'));
            await new Promise((resolve) => setTimeout(resolve, 120));
            controller.enqueue(encoder.encode('data: [DONE]\n\n'));
            controller.close();
          },
        });
        return new Response(body, { status: 200, headers: sseHeaders });
      }) as unknown as typeof fetch,
    });
    await expect(client.chat(request)).resolves.toEqual({ content: '答', reasoningContent: '' });
  });

  it('响应头之后仍受本地超时约束（不再无限等待）', async () => {
    vi.useFakeTimers();
    try {
      const client = new ZhihuClient({ accessSecret: 's', baseUrl: 'https://example.test', fetchImpl: streamingFetch() });
      const pending = client.chat(request);
      const assertion = expect(pending).rejects.toMatchObject({ kind: 'timeout' });
      // 流式预算远大于搜索（默认 55s），快进过去即可，无需真等。
      await vi.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
