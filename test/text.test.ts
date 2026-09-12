/**
 * 文本与 URL 清洗测试。
 *
 * 这些函数决定模型实际看到的内容，且全是纯函数 —— 必须逐条钉死。
 */

import { describe, expect, it } from 'vitest';
import { decodeEntities, sanitizeSnippet, stripTrackingParams } from '../src/utils/text.js';

describe('sanitizeSnippet', () => {
  it('剥掉知乎高亮标签', () => {
    expect(sanitizeSnippet('使用 <em>RAG</em> 做检索增强')).toBe('使用 RAG 做检索增强');
  });

  it('解码 HTML 实体', () => {
    expect(sanitizeSnippet('&quot;向量数据库&quot; &amp; 检索')).toBe('"向量数据库" & 检索');
  });

  it('删除残留标签，避免外部 HTML 进入模型上下文', () => {
    expect(sanitizeSnippet('安全<script>alert(1)</script>文本')).toBe('安全alert(1)文本');
  });

  it('折叠换行与连续空白', () => {
    expect(sanitizeSnippet('第一行\n\n第二行   有空格')).toBe('第一行 第二行 有空格');
  });

  it('超长时截断并加省略号', () => {
    const result = sanitizeSnippet('a'.repeat(500), 10);
    expect(result).toHaveLength(10);
    expect(result.endsWith('…')).toBe(true);
  });

  it('空输入返回空串', () => {
    expect(sanitizeSnippet('')).toBe('');
  });
});

describe('decodeEntities', () => {
  it('保留未知实体原样', () => {
    expect(decodeEntities('&unknown;')).toBe('&unknown;');
  });
});

describe('stripTrackingParams', () => {
  it('剥离知乎追加的 utm 溯源参数', () => {
    expect(stripTrackingParams('https://www.zhihu.com/question/1/answer/2?utm_medium=openapi_platform&utm_source=abc123')).toBe(
      'https://www.zhihu.com/question/1/answer/2',
    );
  });

  it('保留业务参数', () => {
    expect(stripTrackingParams('https://example.com/a?page=2&utm_source=x')).toBe('https://example.com/a?page=2');
  });

  it('保留锚点', () => {
    expect(stripTrackingParams('https://example.com/a?utm_source=x#sec')).toBe('https://example.com/a#sec');
  });

  it('无法解析时原样返回而不是抛错', () => {
    expect(stripTrackingParams('not a url')).toBe('not a url');
  });
});
