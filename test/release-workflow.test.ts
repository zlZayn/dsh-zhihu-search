/**
 * 发布流程不变量：**发布不得改写版本号**（跨仓规则 5b，2026-09-22 立）。
 *
 * 为什么要有它：界面上的版本 tag 显示的就是 `package.json` 里那个号。
 * 只要 workflow 在发布时自己 bump，工作树就永远停在「上一个已发布版本」——
 * **截图必然拍出旧号**。本仓 2026-09-22 就是这么翻的车：图里的 `v2.0.0-alpha.0` 是**上一个**
 * 已发布版本，而当时以为界面上会自己变成新号。
 *
 * 顺序因此定死（写进 [docs/PUBLISHING.md](../docs/PUBLISHING.md) 与
 * [assets/AGENTS.md](../assets/AGENTS.md)）：**bump → 提交 → 再拍截图 → 最后发布**。
 * 两步都在本地，workflow 只负责「把 `package.json` 里那个号发出去」。
 *
 * 判定本体在 [scripts/check-release.mjs](../scripts/check-release.mjs) 的 `findVersionWrites`
 * —— 守卫与测试读**同一份**，且这条守卫每次 `npm test` 都跑（跑 release.yml 只能在 main 上 dispatch）。
 * 下面那组反向控制喂的是**合成文本**，证明这个判据真的会红（不是空转）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { findVersionWrites } from '../scripts/check-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const workflow = readFileSync(root + '.github/workflows/release.yml', 'utf8');

describe('发布流程：版本驱动', () => {
  it('release.yml 里没有会改写版本号的命令行', () => {
    expect(findVersionWrites(workflow)).toEqual([]);
  });

  it('发布的版本号读自 package.json，没有 bump 步', () => {
    // 正向判据：workflow 必须有一处把清单里的版本读出来，而不是自己算一个。
    expect(workflow).toContain("require('./package.json').version");
    // 反向判据：不能有会**改写清单**的步骤（读版本号本身不算）。
    // 「有 dist_tag 输出」也顺带证明它走的不是自己算版本那条路。
    expect(workflow).toContain('dist_tag=');
  });

  it('dist-tag 由版本自己的预发布段推导，publish 与 Release 读同一个输出', () => {
    // 判据只此一处：publish 与 GitHub Release 两步都读 steps.version.outputs.dist_tag（各出现两次：
    // 一次判空、一次取值），都不按输入参数判。
    expect((workflow.match(/steps\.version\.outputs\.dist_tag/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(workflow).not.toContain('inputs.tier');
    expect(workflow).not.toContain('inputs.preid');
  });

  it('幂等判据仍在：该版本已在 npm 上就跳过 publish', () => {
    expect(workflow).toContain('npm view');
    expect(workflow).toContain('published=true');
  });
});

describe('发布流程守卫：反向控制（喂合成文本）', () => {
  it('四种改版本的写法都会红', () => {
    // 上一版 workflow 里真实出现过的那种 case 分支。
    const oldBranch = [
      '          case "${{ inputs.tier }}" in',
      '            prerelease) version=$(npm version prerelease --preid=alpha --no-git-tag-version) ;;',
      '          esac',
    ].join('\n');
    expect(findVersionWrites(oldBranch)).toHaveLength(1);
    expect(findVersionWrites('run: npm version patch --no-git-tag-version')).toHaveLength(1);
    expect(findVersionWrites('run: npm pkg set version=2.0.0-alpha.1')).toHaveLength(1);
    // 直接改写清单里那一行也算。
    expect(findVersionWrites('  "version": "2.0.0-alpha.1",')).toHaveLength(1);
  });

  it('把真 workflow 改坏一处，判据就红（端到端反向控制）', () => {
    // 拿真文件做底、只插一行：证明「现在这条绿」不是因为正则匹配不到任何东西。
    const mutated = workflow.replace(
      "        id: version\n",
      "        id: version\n        run: npm version patch --no-git-tag-version\n",
    );
    expect(mutated).not.toBe(workflow);
    expect(findVersionWrites(mutated)).toHaveLength(1);
  });

  it('提示语与注释不算 —— 否则「提醒你先本地 bump」这句正确的话会判自己红', () => {
    expect(findVersionWrites('# 换版本线在本地做：npm version premajor --preid=alpha --no-git-tag-version')).toEqual([]);
    expect(findVersionWrites('          echo "bump with: npm version <version> --no-git-tag-version"')).toEqual([]);
    expect(findVersionWrites('            # 这里不是叫你在本地 bump：本 workflow 自己 bump')).toEqual([]);
  });
});
