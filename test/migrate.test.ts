/**
 * 旧明文迁徙的纯逻辑契约。
 *
 * 三条纪律各有一组用例，其中**顺序**那条断言的是调用序列而不是结果 ——
 * 「先写后删」如果反过来，中途失败就是密钥永久丢失，而这个差别在终态上看不出来。
 */

import { describe, expect, it } from 'vitest';
import { migrateLegacySecret, type MigrationDeps } from '../src/migrate.js';

/** 构造夹具：`calls` 记录调用顺序，`warnings` 收集诊断。 */
function makeDeps(overrides: Partial<MigrationDeps> = {}) {
  const calls: string[] = [];
  const warnings: string[] = [];
  const deps: MigrationDeps = {
    readLegacy: () => ({}),
    hasCredential: async () => {
      calls.push('hasCredential');
      return false;
    },
    adopt: async (value) => {
      calls.push(`adopt:${value}`);
    },
    purge: async () => {
      calls.push('purge');
    },
    referenceName: () => 'ZHIHU_ACCESS_SECRET',
    warn: (message) => {
      warnings.push(message);
    },
    ...overrides,
  };
  return { deps, calls, warnings };
}

describe('migrateLegacySecret', () => {
  it('没有旧明文时一个外部动作都不做', async () => {
    const { deps, calls, warnings } = makeDeps();
    await migrateLegacySecret(deps);
    expect(calls).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it('把空白串当成没有，不给凭据域写空值', async () => {
    const { deps, calls } = makeDeps({
      readLegacy: () => ({ fromSettings: '   ', fromComposition: '' }),
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual([]);
  });

  it('先写凭据域、后删明文 —— 顺序不可换', async () => {
    const { deps, calls } = makeDeps({
      readLegacy: () => ({ fromSettings: 'LEGACY' }),
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:LEGACY', 'purge']);
  });

  it('凭据域已有值时保留它，只清掉被遮蔽的明文', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromSettings: 'STALE' }),
      hasCredential: async () => true,
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['purge']);
    expect(warnings.join('')).toContain('保留');
  });

  it('写不进去时绝不删明文（删了就永久丢失）', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromSettings: 'MUST-SURVIVE' }),
      adopt: async () => {
        throw new Error('凭据存储拒绝写入');
      },
    });
    await migrateLegacySecret(deps);
    expect(calls).not.toContain('purge');
    expect(warnings.join('')).toContain('凭据存储拒绝写入');
    expect(warnings.join('')).toContain('原样保留');
  });

  it('删不掉时如实告警，并说明密钥已经可用', async () => {
    const { deps, warnings } = makeDeps({
      readLegacy: () => ({ fromSettings: 'LEGACY' }),
      purge: async () => {
        throw new Error('设置文档只读');
      },
    });
    await migrateLegacySecret(deps);
    expect(warnings.join('')).toContain('设置文档只读');
    expect(warnings.join('')).toContain('手动');
  });

  it('组合配置里的明文搬得走、删不掉，只告警', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromComposition: 'FROM-PATCH' }),
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:FROM-PATCH']);
    expect(warnings.join('')).toContain('cordis.patch.yml');
  });

  it('两层都有时搬设置层那一份，并把两件事都说清楚', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromSettings: 'FROM-SETTINGS', fromComposition: 'FROM-PATCH' }),
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:FROM-SETTINGS', 'purge']);
    expect(warnings.join('')).toContain('cordis.patch.yml');
  });

  it('幂等：明文被清掉后再跑一次是空操作', async () => {
    const userLayer: Record<string, unknown> = { accessSecret: 'LEGACY' };
    const calls: string[] = [];
    const deps: MigrationDeps = {
      readLegacy: () => ({ fromSettings: userLayer['accessSecret'] as string | undefined }),
      hasCredential: async () => false,
      adopt: async (value) => {
        calls.push(`adopt:${value}`);
      },
      purge: async () => {
        calls.push('purge');
        delete userLayer['accessSecret'];
      },
      referenceName: () => 'ZHIHU_ACCESS_SECRET',
      warn: () => undefined,
    };

    await migrateLegacySecret(deps);
    expect(calls).toEqual(['adopt:LEGACY', 'purge']);
    // 第二次进入时 user 层已经干净，因此连一次外部调用都不该发生。
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['adopt:LEGACY', 'purge']);
  });
});
