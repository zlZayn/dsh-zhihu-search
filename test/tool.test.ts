/**
 * 工具端到端测试。
 *
 * 全部走真实的 `ZhihuClient`，只替换最外层 `fetch` —— 因此鉴权头拼装、
 * 信封拆解、错误映射、URL 编码这几条容易静默出错的链路都被真实覆盖。
 */

import { describe, expect, it } from 'vitest';
import { createZhihuGlobalSearchTool } from '../src/tools/global-search.js';
import { createZhihuSearchTool } from '../src/tools/search.js';
import { createZhihuZhidaTool } from '../src/tools/zhida.js';
import type { SearchOutput, ZhidaOutput } from '../src/types.js';
import { envelope, execContext, jsonResponse, makeHarness, sseResponse } from './helpers.js';

/** 一条贴近真实生产响应的站内搜索条目。 */
const apiItem = {
  Title: '如何入门 <em>RAG</em>',
  ContentType: 'Answer',
  ContentID: '1',
  ContentText: '先看 <em>论文</em> 再动手',
  Url: 'https://www.zhihu.com/question/1/answer/2?utm_medium=openapi_platform&utm_source=deadbeef',
  CommentCount: 3,
  VoteUpCount: 42,
  AuthorName: '张三',
  EditTime: 1_700_000_000,
  AuthorityLevel: 4,
};

describe('zhihu_search', () => {
  const makeTool = (handler: Parameters<typeof makeHarness>[0]) => {
    const harness = makeHarness(handler);
    return { tool: createZhihuSearchTool(harness.deps), harness };
  };

  it('声明了工具名、超时预算与并发安全分类', () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    expect(tool.name).toBe('zhihu_search');
    expect(tool.timeoutMs).toBe(15_000);
    expect(tool.isConcurrencySafe?.({ query: 'x' })).toBe(true);
    harness.dispose();
  });

  it('投影结果：剥离 utm 溯源参数并清洗高亮标签', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [apiItem] })));
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;

    expect(value.ok).toBe(true);
    expect(value.items).toHaveLength(1);
    expect(value.items[0]?.title).toBe('如何入门 RAG');
    expect(value.items[0]?.snippet).toBe('先看 论文 再动手');
    expect(value.items[0]?.url).toBe('https://www.zhihu.com/question/1/answer/2');
    expect(value.items[0]?.voteUpCount).toBe(42);
    harness.dispose();
  });

  it('丢弃没有链接的结果，避免无用的上下文占用', async () => {
    const { tool, harness } = makeTool(async () =>
      jsonResponse(envelope({ HasMore: false, Items: [apiItem, { ...apiItem, Url: '' }] })),
    );
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.items).toHaveLength(1);
    harness.dispose();
  });

  it('本地把 count 截断到端点上限 10', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    await tool.execute({ query: 'RAG', count: 999 }, execContext());
    expect(harness.urls[0]).toContain('Count=10');
    harness.dispose();
  });

  it('把语义化排序编译进 URL，模型看不到原始语法', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    await tool.execute({ query: 'RAG', sortField: 'voteUpCount', minValue: 100 }, execContext());
    expect(harness.urls[0]).toContain('SortBy=VoteUpCount%3Adesc%3A%28100%2C%29');
    harness.dispose();
  });

  it('把日期编译成 publish_time 过滤', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    await tool.execute({ query: 'RAG', publishedAfter: '2024-01-01' }, execContext());
    expect(harness.urls[0]).toContain('Filter=publish_time%3E%3D1704067200');
    harness.dispose();
  });

  it('每次请求都带 Bearer 与秒级时间戳', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    await tool.execute({ query: 'RAG' }, execContext());
    const header = harness.headers[0] ?? {};
    expect(header['Authorization']).toBe('Bearer test-secret');
    expect(Number(header['X-Request-Timestamp'])).toBeGreaterThan(1_600_000_000);
    harness.dispose();
  });

  it('把平台错误映射成结构化输出而不是抛错', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse({ Code: 20001, Message: 'auth failed', Data: null }));
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('auth');
    expect(value.error?.hint).toContain('10 分钟');
    harness.dispose();
  });

  it('空查询直接返回参数错误，不发出请求', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({})));
    const value = (await tool.execute({ query: '   ' }, execContext())) as SearchOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('param');
    expect(harness.urls).toHaveLength(0);
    harness.dispose();
  });

  it('相同查询命中缓存，不重复消耗知乎额度', async () => {
    let calls = 0;
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return jsonResponse(envelope({ HasMore: false, Items: [apiItem] }));
    });
    await tool.execute({ query: 'RAG', count: 5 }, execContext());
    await tool.execute({ query: 'RAG', count: 5 }, execContext());
    expect(calls).toBe(1);
    harness.dispose();
  });

  it('参数键顺序不同仍命中同一缓存', async () => {
    let calls = 0;
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return jsonResponse(envelope({ HasMore: false, Items: [] }));
    });
    await tool.execute({ query: 'RAG', count: 5, order: 'desc' }, execContext());
    await tool.execute({ query: 'RAG', order: 'desc', count: 5 }, execContext());
    expect(calls).toBe(1);
    harness.dispose();
  });

  it('90001 服务端错误自动重试一次，调用方无感', async () => {
    let calls = 0;
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ Code: 90001, Message: 'internal', Data: null })
        : jsonResponse(envelope({ HasMore: false, Items: [apiItem] }));
    });
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.ok).toBe(true);
    expect(calls).toBe(2);
    harness.dispose();
  });

  it('确定性错误不重试 —— 重试只会白白多花一次往返', async () => {
    let calls = 0;
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return jsonResponse({ Code: 30001, Message: 'rate limit exceeded', Data: null });
    });
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.error?.kind).toBe('rate_limit');
    expect(calls).toBe(1);
    harness.dispose();
  });

  it('失败结果不入缓存，允许稍后重试取得成功', async () => {
    let calls = 0;
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return calls === 1
        ? jsonResponse({ Code: 30001, Message: 'rate limit exceeded', Data: null })
        : jsonResponse(envelope({ HasMore: false, Items: [apiItem] }));
    });
    const first = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    const second = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(first.ok).toBe(false);
    expect(second.ok).toBe(true);
    expect(calls).toBe(2);
    harness.dispose();
  });

  it('额度耗尽时返回本地限流错误，并说明未消耗额度', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    const limiter = new (await import('../src/state.js')).TokenBucket({
      capacity: 1,
      refillPerMinute: 60,
      now: () => 0,
    });
    const tool = createZhihuSearchTool({ ...harness.deps, searchBucket: limiter });
    await tool.execute({ query: 'a' }, execContext());
    const value = (await tool.execute({ query: 'b' }, execContext())) as SearchOutput;
    expect(value.error?.kind).toBe('local_rate_limit');
    expect(value.error?.hint).toContain('未消耗');
    harness.dispose();
  });

  it('两个搜索工具的 Canonical Output schema 完全一致（防止契约漂移）', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({})));
    const local = createZhihuSearchTool(harness.deps);
    const global = createZhihuGlobalSearchTool(harness.deps);
    expect(local.output.schema).toEqual(global.output.schema);
    harness.dispose();
  });
});

describe('zhihu_global_search', () => {
  it('把 site 编译为 host 过滤', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    const tool = createZhihuGlobalSearchTool(harness.deps);
    await tool.execute({ query: 'crawler', site: 'github.com' }, execContext());
    expect(harness.urls[0]).toContain('Filter=host%3D%3D%22github.com%22');
    harness.dispose();
  });

  it('知乎域名在本地就被拒绝，不浪费一次请求', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({})));
    const tool = createZhihuGlobalSearchTool(harness.deps);
    const value = (await tool.execute({ query: 'crawler', site: 'zhihu.com' }, execContext())) as SearchOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('param');
    expect(value.error?.hint).toContain('站内搜索');
    expect(harness.urls).toHaveLength(0);
    harness.dispose();
  });

  it('本地把 count 截断到端点上限 20', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    const tool = createZhihuGlobalSearchTool(harness.deps);
    await tool.execute({ query: 'x', count: 500 }, execContext());
    expect(harness.urls[0]).toContain('Count=20');
    harness.dispose();
  });

  it('不暴露 SortBy（该端点实测忽略排序）', () => {
    const harness = makeHarness(async () => jsonResponse(envelope({})));
    const tool = createZhihuGlobalSearchTool(harness.deps);
    expect(Object.keys(tool.parameters)).not.toContain('sortField');
    harness.dispose();
  });
});

describe('zhihu_zhida', () => {
  const sseChunks = [
    ': keep-alive\n\n',
    'data: {"choices":[{"delta":{"reasoning_content":"先想一下"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"检索增强生成"}}]}\n\n',
    'data: [DONE]\n\n',
  ];

  it('拼接 SSE 流并把思维链与正文分开', async () => {
    const harness = makeHarness(async () => sseResponse(sseChunks));
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: '什么是 RAG', mode: 'thinking', includeReasoning: true }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(true);
    expect(value.answer).toBe('检索增强生成');
    expect(value.reasoning).toBe('先想一下');
    expect(value.model).toBe('zhida-thinking-1p5');
    harness.dispose();
  });

  it('默认不把思维链交给模型', async () => {
    const harness = makeHarness(async () => sseResponse(sseChunks));
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: '什么是 RAG' }, execContext())) as ZhidaOutput;
    expect(value.answer).toBe('检索增强生成');
    expect(value.reasoning).toBe('');
    harness.dispose();
  });

  it('缓存含思维链：后续开启 includeReasoning 无需再次请求', async () => {
    let calls = 0;
    const harness = makeHarness(async () => {
      calls += 1;
      return sseResponse(sseChunks);
    });
    const tool = createZhihuZhidaTool(harness.deps);
    const first = (await tool.execute({ question: '什么是 RAG', includeReasoning: false }, execContext())) as ZhidaOutput;
    const second = (await tool.execute({ question: '什么是 RAG', includeReasoning: true }, execContext())) as ZhidaOutput;
    expect(first.reasoning).toBe('');
    expect(second.reasoning).toBe('先想一下');
    expect(calls).toBe(1);
    harness.dispose();
  });

  it('把语义化档位映射为真实模型 id', async () => {
    const harness = makeHarness(async () => sseResponse(sseChunks));
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q', mode: 'fast' }, execContext())) as ZhidaOutput;
    expect(value.model).toBe('zhida-fast-1p5');
    harness.dispose();
  });

  it('直答返回非事件流时给出结构化错误', async () => {
    const harness = makeHarness(async () =>
      jsonResponse({ error: { message: 'model overloaded', type: 'server_error', param: null, code: 'busy' } }, 200),
    );
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q' }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.message).toContain('model overloaded');
    harness.dispose();
  });

  it('空答案被视为错误，而不是返回空字符串', async () => {
    const harness = makeHarness(async () => sseResponse(['data: {"choices":[{"delta":{}}]}\n\n', 'data: [DONE]\n\n']));
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q' }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('param');
    harness.dispose();
  });
});
