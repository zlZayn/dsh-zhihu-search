/**
 * 旧明文迁徙的纯逻辑契约。
 *
 * 0.1.7 起只剩**组合配置**一个来源（旧 settings.yaml 那半边随宿主一起没了），
 * 因此这里不再有「先写后删」的顺序断言 —— 没有任何东西可删，
 * 「搬不动就原样保留」是**结构性**成立的，而不是靠调用顺序保证。
 *
 * 仍然守着的是另外两条：**凭据域已有值时不覆盖**、**只吞预期失败**。
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
    const { deps, calls } = makeDeps({ readLegacy: () => ({ fromComposition: '   ' }) });
    await migrateLegacySecret(deps);
    expect(calls).toEqual([]);
  });

  it('组合配置里的明文搬进凭据域，并告警请人手动删掉那一行', async () => {
    const { deps, calls, warnings } = makeDeps({ readLegacy: () => ({ fromComposition: 'FROM-PATCH' }) });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:FROM-PATCH']);
    expect(warnings.join('')).toContain('cordis.patch.yml');
    expect(warnings.join('')).toContain('手动移除');
  });

  it('凭据域已有值时绝不覆盖，只把组合配置那份说成残留', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromComposition: 'STALE' }),
      // 这个覆盖把默认替身的记账一起换掉了，所以下面断言的是**效果**：
      // 一次 adopt 都没发生（`calls` 里既没有 adopt，也没有默认的那条 hasCredential）。
      hasCredential: async () => true,
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual([]);
    expect(warnings.join('')).toContain('保留');
    expect(warnings.join('')).toContain('残留');
  });

  it('写不进去时明文原样留在组合配置里，只告警', async () => {
    const { deps, calls, warnings } = makeDeps({
      readLegacy: () => ({ fromComposition: 'MUST-SURVIVE' }),
      adopt: async () => {
        throw new Error('凭据存储拒绝写入');
      },
    });
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential']);
    expect(warnings.join('')).toContain('凭据存储拒绝写入');
    expect(warnings.join('')).toContain('原样保留');
  });

  it('幂等：组合配置那一行删不掉，第二次进入不再重写凭据域', async () => {
    // 明文永远留在 patch 里（插件改不了组合配置），所以「幂等」的含义是
    // 「第二次不再写一遍」，而不是「第二次什么都不做」。
    const store = new Map<string, string>();
    const calls: string[] = [];
    const deps: MigrationDeps = {
      readLegacy: () => ({ fromComposition: 'LEGACY' }),
      hasCredential: async () => {
        calls.push('hasCredential');
        return store.size > 0;
      },
      adopt: async (value) => {
        calls.push(`adopt:${value}`);
        store.set('ZHIHU_ACCESS_SECRET', value);
      },
      referenceName: () => 'ZHIHU_ACCESS_SECRET',
      warn: () => undefined,
    };

    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:LEGACY']);
    await migrateLegacySecret(deps);
    expect(calls).toEqual(['hasCredential', 'adopt:LEGACY', 'hasCredential']);
    expect(store.get('ZHIHU_ACCESS_SECRET')).toBe('LEGACY');
  });
});
