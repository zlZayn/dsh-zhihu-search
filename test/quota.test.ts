/**
 * 额度自检端点契约测试。
 *
 * `ZhihuClient.quota()` 是随包导出的公开方法（注释写明「实测不消耗业务额度，可用于自检」），
 * 但此前零调用零覆盖。这里把它的端点、鉴权头与失败形态钉住，
 * 免得将来有人改端点或把失败吞成坏数据时无人察觉。
 */

import { describe, expect, it } from 'vitest';
import { ZhihuClient, ZhihuClientError } from '../src/transport.js';
import { envelope, jsonResponse, makeHarness } from './helpers.js';

describe('ZhihuClient.quota', () => {
  it('打到 /api/v1/quota，并带上 Bearer 与秒级时间戳', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ Quota: 5000 })));
    await harness.deps.client.quota();
    expect(harness.urls[0]).toContain('/api/v1/quota');
    expect(harness.headers[0]?.['Authorization']).toBe('Bearer test-secret');
    expect(Number(harness.headers[0]?.['X-Request-Timestamp'])).toBeGreaterThan(1_600_000_000);
    harness.dispose();
  });

  it('原样返回平台载荷，怎么读交给调用方', async () => {
    const harness = makeHarness(async () => jsonResponse(envelope({ Quota: 5000, Used: 12 })));
    await expect(harness.deps.client.quota()).resolves.toEqual({ Quota: 5000, Used: 12 });
    harness.dispose();
  });

  it('失败时抛 ZhihuClientError，而不是返回坏数据', async () => {
    const harness = makeHarness(async () => jsonResponse({ Code: 20001, Message: 'auth failed', Data: null }));
    await expect(harness.deps.client.quota()).rejects.toBeInstanceOf(ZhihuClientError);
    harness.dispose();
  });

  it('未配置密钥时不发请求，直接给鉴权错误', async () => {
    const urls: string[] = [];
    const client = new ZhihuClient({
      fetchImpl: (async (input: string) => {
        urls.push(String(input));
        return jsonResponse(envelope(null));
      }) as typeof fetch,
    });
    await expect(client.quota()).rejects.toBeInstanceOf(ZhihuClientError);
    expect(urls).toHaveLength(0);
  });
});
