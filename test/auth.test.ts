/**
 * 密钥解析通道测试。
 *
 * 覆盖「字面量配置 → 凭据服务」的优先级与失败形态。
 * 这是设置界面生效的前提：界面写的是凭据服务，插件读的也必须是它。
 */

import { describe, expect, it } from 'vitest';
import { ZhihuClient, ZhihuClientError } from '../src/transport.js';

/** 记录请求头的替身 fetch。 */
function headerSpy(): { fetchImpl: typeof fetch; headers: Array<Record<string, string>> } {
  const headers: Array<Record<string, string>> = [];
  const fetchImpl = (async (_input: string, init?: RequestInit) => {
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify({ Code: 0, Message: 'success', Data: { HasMore: false, Items: [] } }), {
      status: 200,
    });
  }) as typeof fetch;
  return { fetchImpl, headers };
}

describe('ZhihuClient 密钥解析', () => {
  it('字面量配置优先于凭据服务', async () => {
    const spy = headerSpy();
    let serviceCalled = false;
    const client = new ZhihuClient({
      accessSecret: 'from-config',
      resolveAccessSecret: async () => {
        serviceCalled = true;
        return 'from-service';
      },
      fetchImpl: spy.fetchImpl,
    });
    await client.searchZhihu({ query: 'x' });
    expect(spy.headers[0]?.['Authorization']).toBe('Bearer from-config');
    expect(serviceCalled).toBe(false);
  });

  it('无字面量时走凭据服务', async () => {
    const spy = headerSpy();
    const client = new ZhihuClient({
      resolveAccessSecret: async () => 'from-service',
      fetchImpl: spy.fetchImpl,
    });
    await client.searchZhihu({ query: 'x' });
    expect(spy.headers[0]?.['Authorization']).toBe('Bearer from-service');
  });

  it('两条通道都空时给出指向设置界面的鉴权错误', async () => {
    const spy = headerSpy();
    const client = new ZhihuClient({ fetchImpl: spy.fetchImpl });
    await expect(client.searchZhihu({ query: 'x' })).rejects.toBeInstanceOf(ZhihuClientError);
    try {
      await client.searchZhihu({ query: 'x' });
    } catch (error) {
      const failure = error as ZhihuClientError;
      expect(failure.kind).toBe('auth');
      expect(failure.hint).toContain('设置');
    }
    expect(spy.headers).toHaveLength(0);
  });

  it('凭据服务返回空白串时同样视为未配置', async () => {
    const spy = headerSpy();
    const client = new ZhihuClient({ resolveAccessSecret: async () => '   ', fetchImpl: spy.fetchImpl });
    await expect(client.searchZhihu({ query: 'x' })).rejects.toBeInstanceOf(ZhihuClientError);
  });

  it('每次请求都重新解析，密钥改动无需重启插件', async () => {
    const spy = headerSpy();
    let current = 'first';
    const client = new ZhihuClient({ resolveAccessSecret: async () => current, fetchImpl: spy.fetchImpl });
    await client.searchZhihu({ query: 'a' });
    current = 'second';
    await client.searchZhihu({ query: 'b' });
    expect(spy.headers[0]?.['Authorization']).toBe('Bearer first');
    expect(spy.headers[1]?.['Authorization']).toBe('Bearer second');
  });
});
