/**
 * 呈现层纯度测试（红线 2 与红线 3 的可执行守卫）。
 *
 * 两条红线都是关于「不可观测的副作用」的：一旦被破坏，症状是
 * 历史会话回放出的卡片与当初不一致 —— 极难复现。所以必须机器校验。
 */

import { describe, expect, it } from 'vitest';
import {
  presentSearchCall,
  presentSearchResult,
  renderSearch,
  searchMetaFromResult,
  searchMetaFromValue,
} from '../src/present/search.js';
import { renderZhida } from '../src/present/zhida.js';
import type { SearchOutput, ZhidaOutput } from '../src/types.js';

const okValue: SearchOutput = {
  ok: true,
  query: 'RAG',
  items: [
    { title: '如何入门 RAG', url: 'https://www.zhihu.com/question/1/answer/2', snippet: '先看论文', author: '张三', voteUpCount: 42, contentType: 'Answer' },
    { title: '向量库对比', url: 'https://www.zhihu.com/question/3/answer/4', snippet: '评测', author: '李四', voteUpCount: 7, contentType: 'Article' },
  ],
  hasMore: false,
};

const failedValue: SearchOutput = {
  ok: false,
  query: 'RAG',
  items: [],
  hasMore: false,
  error: { kind: 'auth', message: '鉴权失败', hint: '检查系统时间' },
};

/** 把内容块拼回一个字符串。 */
function textOf(blocks: ReadonlyArray<{ type: string; text?: string }>): string {
  return blocks.map((block) => block.text ?? '').join('\n');
}

describe('renderSearch（模型可见层）', () => {
  it('返回 ContentBlock 数组而不是字符串', () => {
    const blocks = renderSearch(okValue);
    expect(Array.isArray(blocks)).toBe(true);
    expect(blocks[0]?.type).toBe('text');
  });

  it('包含标题、链接、作者、点赞数与摘要', () => {
    const text = textOf(renderSearch(okValue));
    expect(text).toContain('[如何入门 RAG](https://www.zhihu.com/question/1/answer/2)');
    expect(text).toContain('**作者**: 张三');
    expect(text).toContain('**点赞**: 42');
    expect(text).toContain('> 先看论文');
  });

  it('红线 2：模型可见文本里绝不出现 UI 卡片字段', () => {
    const text = textOf(renderSearch(okValue));
    for (const forbidden of ['"card"', "'card'", 'card:', 'sources', 'presentationMeta', 'truncated', 'kind:']) {
      expect(text).not.toContain(forbidden);
    }
  });

  it('失败时给出错误与补救建议', () => {
    const text = textOf(renderSearch(failedValue));
    expect(text).toContain('鉴权失败');
    expect(text).toContain('检查系统时间');
  });

  it('无结果时给出明确空态而不是空字符串', () => {
    const text = textOf(renderSearch({ ...okValue, items: [] }));
    expect(text).toContain('未找到');
    expect(text).toContain('RAG');
  });

  it('转义标题里的方括号，避免破坏 Markdown 链接结构', () => {
    const text = textOf(renderSearch({ ...okValue, items: [{ ...okValue.items[0]!, title: 'RAG[入门]' }] }));
    expect(text).toContain('\\[入门\\]');
  });

  it('内容类型缺失时整段省略，不编造标签（实测外部网页没有 ContentType）', () => {
    const text = textOf(renderSearch({ ...okValue, items: [{ ...okValue.items[0]!, contentType: '' }] }));
    expect(text).not.toContain('类型');
    expect(text).toContain('**点赞**: 42');
  });

  it('hasMore 为真时把「结果被截断」告诉模型（工具没有翻页参数）', () => {
    const text = textOf(renderSearch({ ...okValue, hasMore: true }));
    expect(text).toContain('结果未全部返回');
  });

  it('hasMore 为假时不出现截断提示', () => {
    expect(textOf(renderSearch(okValue))).not.toContain('结果未全部返回');
  });
});

describe('searchMetaFromValue（红线 3：必须是纯函数）', () => {
  it('连续两次调用产生完全相同的 JSON', () => {
    expect(JSON.stringify(searchMetaFromValue(okValue))).toBe(JSON.stringify(searchMetaFromValue(okValue)));
  });

  it('不掺入时间戳或随机数', () => {
    const serialized = JSON.stringify(searchMetaFromValue(okValue));
    expect(serialized).not.toMatch(/\d{13}/); // 毫秒时间戳
    expect(serialized).not.toMatch(/\.\d{6,}/); // 高精度浮点
  });

  it('只承载 Markdown 无法无损表达的结构化来源', () => {
    const meta = searchMetaFromValue(okValue) as { sources: Array<{ url: string }>; truncated: boolean };
    expect(meta.sources).toHaveLength(2);
    expect(meta.sources[0]?.url).toBe('https://www.zhihu.com/question/1/answer/2');
    expect(meta.truncated).toBe(false);
  });

  it('不复制模型可见的 Markdown', () => {
    const serialized = JSON.stringify(searchMetaFromValue(okValue));
    expect(serialized).not.toContain('**作者**');
    expect(serialized).not.toContain('### ');
  });

  it('序列化结果可被 lossless JSON 往返', () => {
    const meta = searchMetaFromValue(okValue);
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });
});

describe('searchMetaFromResult（回放鲁棒性）', () => {
  it('对畸形元数据返回 undefined 而不是抛错', () => {
    for (const bad of [undefined, null, 42, 'x', {}, { sources: 'no' }, { sources: [null, 1, {}] }]) {
      expect(() => searchMetaFromResult(bad)).not.toThrow();
    }
    expect(searchMetaFromResult({ sources: [null, 1, {}] })).toEqual({ sources: [], truncated: false });
  });

  it('丢弃缺少 url 的来源', () => {
    const meta = searchMetaFromResult({ sources: [{ url: 'https://a' }, { title: 'no url' }], truncated: true });
    expect(meta?.sources).toHaveLength(1);
    expect(meta?.truncated).toBe(true);
  });
});

describe('presentSearchResult（UI 层）', () => {
  const result = { content: renderSearch(okValue), isError: false, meta: searchMetaFromValue(okValue) };

  it('产出 web 搜索卡片并携带结构化来源', () => {
    const view = presentSearchResult({ query: 'RAG' }, result);
    expect(view?.card).toBe('web');
    expect(view?.kind).toBe('search');
    expect(view?.sources).toHaveLength(2);
  });

  it('失败时返回 undefined，交回 UI 渲染原始文本', () => {
    expect(presentSearchResult({ query: 'RAG' }, { ...result, isError: true })).toBeUndefined();
  });

  it('元数据缺失时返回 undefined 而不是崩溃', () => {
    expect(presentSearchResult({ query: 'RAG' }, { content: [], isError: false })).toBeUndefined();
  });

  it('卡片数据与模型可见文本严格分离', () => {
    const view = presentSearchResult({ query: 'RAG' }, result);
    const modelText = textOf(renderSearch(okValue));
    expect(modelText).not.toContain(JSON.stringify(view));
    expect(modelText).not.toContain('"card"');
  });

  it('待执行卡片只描述查询', () => {
    const view = presentSearchCall({ query: 'RAG' });
    expect(view.card).toBe('generic');
    expect(view.title).toContain('RAG');
  });
});

describe('renderZhida', () => {
  const value: ZhidaOutput = { ok: true, question: '什么是 RAG', model: 'zhida-thinking-1p5', answer: '检索增强生成', reasoning: '先想一下' };

  it('默认不把思维链交给模型（省上下文）', () => {
    const text = textOf(renderZhida(value));
    expect(text).toContain('检索增强生成');
    expect(text).not.toContain('先想一下');
  });

  it('显式开启时附上思维链', () => {
    expect(textOf(renderZhida(value, true))).toContain('先想一下');
  });

  it('失败时给出错误与建议', () => {
    const text = textOf(renderZhida({ ...value, ok: false, answer: '', error: { kind: 'rate_limit', message: '太快了', hint: '慢一点' } }));
    expect(text).toContain('太快了');
    expect(text).toContain('慢一点');
  });
});
