/**
 * 密钥解析优先级测试。
 *
 * 优先级是契约：它决定「用户在设置里填了密钥」这件事会不会生效。
 */

import { describe, expect, it } from 'vitest';
import { resolveAccessSecret, type SecretSources } from '../src/credentials.js';

/** 构造三条来源都可控的夹具。 */
function sources(overrides: Partial<SecretSources> = {}): SecretSources {
  return {
    referenceName: () => 'ZHIHU_ACCESS_SECRET',
    fromCredentials: async () => undefined,
    fromSettings: () => undefined,
    fromEnvironment: () => undefined,
    ...overrides,
  };
}

describe('resolveAccessSecret', () => {
  it('凭据域优先', async () => {
    const value = await resolveAccessSecret(
      sources({
        fromCredentials: async () => 'from-credentials',
        fromSettings: () => 'from-settings',
        fromEnvironment: () => 'from-env',
      }),
    );
    expect(value).toBe('from-credentials');
  });

  it('凭据域为空时回落到设置值', async () => {
    const value = await resolveAccessSecret(
      sources({ fromSettings: () => 'from-settings', fromEnvironment: () => 'from-env' }),
    );
    expect(value).toBe('from-settings');
  });

  it('凭据域与设置都为空时回落到环境变量', async () => {
    expect(await resolveAccessSecret(sources({ fromEnvironment: () => 'from-env' }))).toBe('from-env');
  });

  it('三条都空时返回 undefined，交由调用方报鉴权错误', async () => {
    expect(await resolveAccessSecret(sources())).toBeUndefined();
  });

  it('把空白串一律视为未配置', async () => {
    const value = await resolveAccessSecret(
      sources({
        fromCredentials: async () => '   ',
        fromSettings: () => '\n\t',
        fromEnvironment: () => 'ok',
      }),
    );
    expect(value).toBe('ok');
  });

  it('引用名透传给凭据域与环境变量，两边用同一个名字', async () => {
    const seen: string[] = [];
    await resolveAccessSecret(
      sources({
        referenceName: () => 'MY_ZHIHU_SECRET',
        fromCredentials: async (ref) => {
          seen.push(`credentials:${ref}`);
          return undefined;
        },
        fromEnvironment: (name) => {
          seen.push(`env:${name}`);
          return 'x';
        },
      }),
    );
    expect(seen).toEqual(['credentials:MY_ZHIHU_SECRET', 'env:MY_ZHIHU_SECRET']);
  });

  it('凭据域没有被注入时不会抛错（服务可选）', async () => {
    await expect(
      resolveAccessSecret(sources({ fromCredentials: async () => undefined, fromEnvironment: () => 'y' })),
    ).resolves.toBe('y');
  });
});
