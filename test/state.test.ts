/**
 * 缓存与限流测试。
 *
 * 全部用注入的时间源，不依赖真实时钟 —— 否则这些测试会在 CI 上随机失败。
 */

import { describe, expect, it } from 'vitest';
import { buildCacheKey, MemoryCache, TokenBucket, stableStringify } from '../src/state.js';

describe('stableStringify', () => {
  it('键顺序不影响结果', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('嵌套对象同样排序', () => {
    expect(stableStringify({ x: { d: 1, c: 2 } })).toBe(stableStringify({ x: { c: 2, d: 1 } }));
  });

  it('数组顺序敏感', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });
});

describe('buildCacheKey', () => {
  const base = { toolName: 'zhihu_search', baseUrl: 'https://x', accessSecret: 'secret-a', args: { q: 1 } };

  it('参数键顺序不同但语义相同则键相同', () => {
    expect(buildCacheKey({ ...base, args: { a: 1, b: 2 } })).toBe(buildCacheKey({ ...base, args: { b: 2, a: 1 } }));
  });

  it('换凭据即换缓存空间', () => {
    expect(buildCacheKey(base)).not.toBe(buildCacheKey({ ...base, accessSecret: 'secret-b' }));
  });

  it('换工具即换缓存空间', () => {
    expect(buildCacheKey(base)).not.toBe(buildCacheKey({ ...base, toolName: 'zhihu_zhida' }));
  });

  it('密钥明文不出现在键里', () => {
    expect(buildCacheKey(base)).not.toContain('secret-a');
  });
});

describe('MemoryCache', () => {
  const makeCache = (now: () => number) => new MemoryCache<string>({ maxEntries: 2, defaultTtlMs: 1000, now });

  it('未过期时命中', () => {
    let t = 0;
    const cache = makeCache(() => t);
    cache.set('k', 'v');
    expect(cache.get('k')).toBe('v');
  });

  it('过期后视为未命中', () => {
    let t = 0;
    const cache = makeCache(() => t);
    cache.set('k', 'v');
    t = 1001;
    expect(cache.get('k')).toBeUndefined();
  });

  it('超出容量时淘汰最久未用条目', () => {
    const t = 0;
    const cache = makeCache(() => t);
    cache.set('a', '1');
    cache.set('b', '2');
    cache.get('a'); // a 变为最近使用
    cache.set('c', '3'); // 应淘汰 b
    expect(cache.get('a')).toBe('1');
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe('3');
  });

  it('dispose 后不再读写', () => {
    const cache = makeCache(() => 0);
    cache.set('k', 'v');
    cache.dispose();
    expect(cache.get('k')).toBeUndefined();
  });
});

describe('TokenBucket', () => {
  it('容量内放行，超出拒绝', () => {
    const bucket = new TokenBucket({ capacity: 2, refillPerMinute: 60, now: () => 0 });
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(true);
    expect(bucket.tryConsume()).toBe(false);
  });

  it('按时间补充令牌', () => {
    let t = 0;
    const bucket = new TokenBucket({ capacity: 60, refillPerMinute: 60, now: () => t });
    for (let i = 0; i < 60; i += 1) bucket.tryConsume();
    expect(bucket.tryConsume()).toBe(false);
    t = 1000; // 1 秒 = 1 个令牌
    expect(bucket.tryConsume()).toBe(true);
  });

  it('补充不超过容量', () => {
    let t = 0;
    const bucket = new TokenBucket({ capacity: 3, refillPerMinute: 60, now: () => t });
    t = 3_600_000;
    expect(bucket.available).toBe(3);
  });

  it('给出去重试等待时间', () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60, now: () => 0 });
    bucket.tryConsume();
    expect(bucket.retryAfterMs()).toBeGreaterThan(0);
  });

  it('dispose 后一律放行，避免卸载时误伤在途请求', () => {
    const bucket = new TokenBucket({ capacity: 1, refillPerMinute: 60, now: () => 0 });
    bucket.tryConsume();
    bucket.dispose();
    expect(bucket.tryConsume()).toBe(true);
  });
});
