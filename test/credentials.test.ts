/**
 * 密钥解析契约。
 *
 * 契约只有一条：**凭据域是唯一的取值口**，进程环境只是 provider 缺席时的兜底。
 * 设置里没有字面量通道 —— 曾经的三源优先级随旧版明文一起作废（[migrate.ts](../src/migrate.ts)）。
 */

import { describe, expect, it } from 'vitest';
import { hasSecretValue, resolveAccessSecret, type SecretSources } from '../src/credentials.js';

/** 构造两条来源都可控的夹具。 */
function sources(overrides: Partial<SecretSources> = {}): SecretSources {
  return {
    referenceName: () => 'ZHIHU_ACCESS_SECRET',
    fromCredentials: async () => undefined,
    fromEnvironment: () => undefined,
    ...overrides,
  };
}

describe('resolveAccessSecret', () => {
  it('凭据域优先于环境变量', async () => {
    const value = await resolveAccessSecret(
      sources({
        fromCredentials: async () => 'from-credentials',
        fromEnvironment: () => 'from-env',
      }),
    );
    expect(value).toBe('from-credentials');
  });

  it('凭据域为空时回落到环境变量', async () => {
    expect(await resolveAccessSecret(sources({ fromEnvironment: () => 'from-env' }))).toBe('from-env');
  });

  it('两条都空时返回 undefined，交由调用方报鉴权错误', async () => {
    expect(await resolveAccessSecret(sources())).toBeUndefined();
  });

  it('把空白串一律视为未配置', async () => {
    const value = await resolveAccessSecret(
      sources({
        fromCredentials: async () => '   ',
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

describe('hasSecretValue', () => {
  it('只有含非空白字符的字符串才算配好了', () => {
    expect(hasSecretValue('sk-x')).toBe(true);
    expect(hasSecretValue('')).toBe(false);
    expect(hasSecretValue('  \t\n')).toBe(false);
    expect(hasSecretValue(undefined)).toBe(false);
  });
});
