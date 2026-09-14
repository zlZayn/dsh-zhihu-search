/**
 * 工具端到端测试。
 *
 * 全部走真实的 `ZhihuClient`，只替换最外层 `fetch` —— 因此鉴权头拼装、
 * 信封拆解、错误映射、URL 编码这几条容易静默出错的链路都被真实覆盖。
 */

import { describe, expect, it } from 'vitest';
import { validateJsonSchemaValue, type JsonSchemaNode } from '@deepseek-ai/dsh-tools';
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

  it('带下限时把候选池取到端点上限，再按请求条数截断', async () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      ...apiItem,
      ContentID: String(i),
      Url: `https://www.zhihu.com/question/1/answer/${String(i)}`,
      VoteUpCount: 100 + i,
    }));
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: many })));
    const value = (await tool.execute(
      { query: 'RAG', count: 3, sortField: 'voteUpCount', minValue: 100 },
      execContext(),
    )) as SearchOutput;
    // 区间只筛本次候选：条数要得越小，候选越少，越容易筛空 —— 所以候选池取端点上限。
    expect(harness.urls[0]).toContain('Count=10');
    // 但交给模型的仍然只有它要的条数。
    expect(value.items).toHaveLength(3);
    harness.dispose();
  });

  it('候选池缓存不被小 count 污染：count=3 之后 count=10 仍能拿满', async () => {
    let calls = 0;
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...apiItem,
      ContentID: String(i),
      Url: `https://www.zhihu.com/question/1/answer/${String(i)}`,
    }));
    const { tool, harness } = makeTool(async () => {
      calls += 1;
      return jsonResponse(envelope({ HasMore: false, Items: many }));
    });
    const small = (await tool.execute({ query: 'RAG', count: 3, sortField: 'voteUpCount', minValue: 1 }, execContext())) as SearchOutput;
    const large = (await tool.execute({ query: 'RAG', count: 10, sortField: 'voteUpCount', minValue: 1 }, execContext())) as SearchOutput;
    expect(small.items).toHaveLength(3);
    expect(large.items).toHaveLength(8);
    // 同一个候选池，因此只发一次请求：缓存的是池子，截断发生在返回路径。
    expect(calls).toBe(1);
    harness.dispose();
  });

  it('投影评论数与时间戳，让「按评论/按时间排」这两个旋钮有读数可核对', async () => {
    const { tool, harness } = makeTool(async () =>
      jsonResponse(envelope({ HasMore: false, Items: [{ ...apiItem, CommentCount: 9 }] })),
    );
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.items[0]?.commentCount).toBe(9);
    expect(value.items[0]?.editTime).toBe(1_700_000_000);
    harness.dispose();
  });

  it('minValue 缺 sortField 时返回 param 错误，而不是静默下发未过滤查询', async () => {
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    const value = (await tool.execute({ query: 'RAG', minValue: 100 }, execContext())) as SearchOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('param');
    expect(value.error?.hint).toBeTruthy();
    // 关键断言：一次请求都没发出去，因此不可能把未过滤的结果当成过滤过的返回。
    expect(harness.urls).toHaveLength(0);
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

  it('上游没报点赞数时省略该字段，不兜底成 0', async () => {
    const raw = {
      Title: '如何入门 RAG',
      ContentType: 'Answer',
      ContentText: '先看论文',
      Url: 'https://www.zhihu.com/question/1/answer/2',
      AuthorName: '张三',
    };
    const { tool, harness } = makeTool(async () => jsonResponse(envelope({ HasMore: false, Items: [raw] })));
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.items[0]).not.toHaveProperty('voteUpCount');
    harness.dispose();
  });

  it('上游报 0 赞时保留 0，不把真零当成缺失', async () => {
    const { tool, harness } = makeTool(async () =>
      jsonResponse(envelope({ HasMore: false, Items: [{ ...apiItem, VoteUpCount: 0 }] })),
    );
    const value = (await tool.execute({ query: 'RAG' }, execContext())) as SearchOutput;
    expect(value.items[0]?.voteUpCount).toBe(0);
    harness.dispose();
  });

  it('两个搜索工具的描述都写明结果只有文字、不含图片', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({})));
    // 模型拿不到图，描述就必须说清楚：否则它会向用户承诺一张它看不到的图。
    for (const tool of [createZhihuSearchTool(harness.deps), createZhihuGlobalSearchTool(harness.deps)]) {
      expect(tool.description).toContain('不含图片');
    }
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

describe('Canonical Output 必须通过自己声明的 output schema', () => {
  // 宿主就是这么校验的（output.schema 是 additionalProperties: false）：
  // 投影层多带一个未声明的键，**整个调用就被判非法**。
  // v1.4.0 正是这样：类型与投影都加了 commentCount / editTime，schema 却漏了，
  // 于是两个搜索工具只要有结果就整体失败 —— 而当时的测试直接读 execute() 的返回值，
  // 从不走 schema 校验，所以全绿放行。这组用例就是补上那道缺口。
  const schemaOf = (tool: { output: { schema: unknown } }): JsonSchemaNode => tool.output.schema as JsonSchemaNode;

  it('两个搜索工具的成功值都合法（结果带齐上游字段）', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [apiItem] })));
    for (const tool of [createZhihuSearchTool(harness.deps), createZhihuGlobalSearchTool(harness.deps)]) {
      const value = await tool.execute({ query: 'RAG' }, execContext());
      expect(validateJsonSchemaValue(schemaOf(tool), value), tool.name).toEqual([]);
    }
    harness.dispose();
  });

  it('两个搜索工具的失败值也合法（错误面同样要过校验）', async () => {
    const harness = makeHarness(async () => jsonResponse({ Code: 20001, Message: 'auth failed', Data: null }));
    for (const tool of [createZhihuSearchTool(harness.deps), createZhihuGlobalSearchTool(harness.deps)]) {
      const value = await tool.execute({ query: 'RAG' }, execContext());
      expect(validateJsonSchemaValue(schemaOf(tool), value), tool.name).toEqual([]);
    }
    harness.dispose();
  });

  it('直答的成功值与失败值都合法', async () => {
    const okHarness = makeHarness(async () =>
      sseResponse(['data: {"choices":[{"delta":{"content":"答"}}]}\n\n', 'data: [DONE]\n\n']),
    );
    const okTool = createZhihuZhidaTool(okHarness.deps);
    const okValue = await okTool.execute({ question: 'q' }, execContext());
    expect(validateJsonSchemaValue(schemaOf(okTool), okValue)).toEqual([]);
    okHarness.dispose();

    const failHarness = makeHarness(async () =>
      jsonResponse({ error: { message: 'boom', type: 'server_error', code: 'internal_error' } }, 500),
    );
    const failTool = createZhihuZhidaTool(failHarness.deps);
    const failValue = await failTool.execute({ question: 'q' }, execContext());
    expect(validateJsonSchemaValue(schemaOf(failTool), failValue)).toEqual([]);
    failHarness.dispose();
  });

  it('守卫本身有效：多一个未声明字段必须被判非法（否则这组用例是空的）', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
    const tool = createZhihuSearchTool(harness.deps);
    const value = {
      ok: true,
      query: 'q',
      items: [{ title: 't', url: 'https://a', snippet: 's', author: 'a', contentType: 'Answer', bogus: 1 }],
      hasMore: false,
    };
    expect(validateJsonSchemaValue(schemaOf(tool), value).length).toBeGreaterThan(0);
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

  it('外站网页的占位 0 如实进 Canonical Output，展示层的取舍归渲染层', async () => {
    // 实测形态：外站网页 ContentType 是空串（字段在、值为空），VoteUpCount 是 0。
    const external = {
      Title: '某接单平台',
      ContentType: '',
      ContentText: '摘要',
      Url: 'https://example.com/a',
      AuthorName: '某站',
      VoteUpCount: 0,
    };
    const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [external] })));
    const tool = createZhihuGlobalSearchTool(harness.deps);
    const value = (await tool.execute({ query: 'crawler' }, execContext())) as SearchOutput;
    expect(value.items).toHaveLength(1);
    expect(value.items[0]?.contentType).toBe('');
    expect(value.items[0]?.voteUpCount).toBe(0);
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

  it('流式中途失败不交付半截答案（官方文档定义的中途错误帧）', async () => {
    const harness = makeHarness(async () =>
      sseResponse([
        'data: {"choices":[{"delta":{"content":"前面这段不该被交付"}}]}\n\n',
        'data: {"choices":[{"delta":{},"finish_reason":"error"}],"error":{"message":"Internal server error","type":"server_error","code":"internal_error"}}\n\n',
        'data: [DONE]\n\n',
      ]),
    );
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q' }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(false);
    expect(value.answer).toBe('');
    expect(value.error?.kind).toBe('server');
    harness.dispose();
  });

  it('直答的错误 code 是字符串时也要分类：频率限制给 rate_limit 与可行动 hint', async () => {
    // 实测形态：直答返回 OpenAI 兼容错误体，code 为字符串（不是数字错误码）。
    const harness = makeHarness(async () =>
      jsonResponse({ error: { message: 'rate limit exceeded', type: 'rate_limit_error', param: null, code: 'rate_limit_exceeded' } }, 429),
    );
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q' }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('rate_limit');
    expect(value.error?.hint).toContain('稍等');
    harness.dispose();
  });

  it('档位未授权（model_not_found）指向换档位，而不是退化成 unknown', async () => {
    const harness = makeHarness(async () =>
      jsonResponse({ error: { message: 'model not found', type: 'invalid_request_error', param: 'model', code: 'model_not_found' } }, 404),
    );
    const tool = createZhihuZhidaTool(harness.deps);
    const value = (await tool.execute({ question: 'q' }, execContext())) as ZhidaOutput;
    expect(value.ok).toBe(false);
    expect(value.error?.kind).toBe('param');
    expect(value.error?.hint).toContain('档位');
    harness.dispose();
  });
});
