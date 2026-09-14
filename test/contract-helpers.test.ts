/**
 * 契约测试底座的**离线**自检。
 *
 * 为什么它跑在日常 CI 里，而真实的契约探针不跑：指纹工具写错会让契约测试
 * 「假绿」—— 那比没有契约测试更危险。这部分不碰网络，代价接近零，所以常驻。
 * 真实探针见 [contract-live-search.test.ts](contract-live-search.test.ts)。
 */

import { describe, expect, it } from 'vitest';
import {
  editTimesOf,
  fingerprintLine,
  hostsOf,
  idsOf,
  isSubdomainOf,
  isSubsetOf,
  sameSequence,
  votesOf,
  type Envelope,
  type RawItem,
} from './contract-helpers.js';

/** 构造一条最小结果。 */
function item(overrides: Partial<RawItem>): RawItem {
  return { ContentID: 'c1', Url: 'https://example.com/a', VoteUpCount: 1, EditTime: 1_700_000_000, ...overrides };
}

describe('契约指纹工具', () => {
  it('idsOf 保序，缺 ContentID 时用位置占位（不静默丢条目）', () => {
    expect(idsOf([item({ ContentID: 'a' }), item({ ContentID: 'b' }), item({ ContentID: undefined })])).toEqual([
      'a',
      'b',
      '#2',
    ]);
  });

  it('hostsOf 取主机名并小写，非法 URL 退化成空串而不是抛错', () => {
    expect(hostsOf([item({ Url: 'https://News.QQ.com/a/1' }), item({ Url: '不是 URL' })])).toEqual([
      'news.qq.com',
      '',
    ]);
  });

  it('votesOf / editTimesOf 对缺失字段给 NaN，避免把「没有」当成 0 参与比较', () => {
    expect(votesOf([item({ VoteUpCount: 0 }), item({ VoteUpCount: undefined })])).toEqual([0, Number.NaN]);
    expect(editTimesOf([item({ EditTime: undefined })])).toEqual([Number.NaN]);
  });

  it('sameSequence 区分顺序，isSubsetOf 只看包含关系', () => {
    expect(sameSequence(['a', 'b'], ['b', 'a'])).toBe(false);
    expect(sameSequence(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isSubsetOf(['a'], ['a', 'b'])).toBe(true);
    expect(isSubsetOf(['a', 'c'], ['a', 'b'])).toBe(false);
  });

  it('isSubdomainOf 只认严格子域，不误伤形似域名', () => {
    expect(isSubdomainOf('news.qq.com', 'qq.com')).toBe(true);
    expect(isSubdomainOf('qq.com', 'qq.com')).toBe(false);
    expect(isSubdomainOf('notqq.com', 'qq.com')).toBe(false);
  });

  it('fingerprintLine 不含结果正文（CI 日志里不落内容）', () => {
    const envelope: Envelope = {
      http: 200,
      code: 0,
      message: 'success',
      dataKeys: ['HasMore', 'SearchHashId', 'Items'],
      items: [item({ Title: '这是标题不该出现在指纹里' })],
      hasMore: false,
      emptyReason: undefined,
      searchHashId: 'h',
    };
    const line = fingerprintLine('站内基线', envelope);
    expect(line).toContain('code=0');
    expect(line).toContain('hosts=[example.com]');
    expect(line).not.toContain('这是标题');
  });
});
