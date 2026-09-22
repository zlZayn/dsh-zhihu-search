/**
 * 声明面读取器。
 *
 * 配置卡片的分派 key 由**两个仓内文件**拼出来：[package.json](../package.json) 的 `name`
 * 与 [cordis.patch.yml](../cordis.patch.yml) 里那条 insert 的 `id`。
 *
 * 测试从这里读，而不是在断言里写死 key —— 写死的话，哪天 patch 的行 id 改了，失配这件事
 * 没人发现：症状是卡片静默消失，页面不报错。
 *
 * 与 [helpers.ts](helpers.ts) / [contract-helpers.ts](contract-helpers.ts) 同类：
 * 本目录的**非测试**夹具模块（vitest 只收 `*.test.ts`）。
 */

import { readFileSync } from 'node:fs';

/** bundle patch 里那条 insert 行的两个名字。 */
export interface PatchRow {
  /** loader 行的 id；卡片 key 的后半就是它。 */
  readonly id: string;
  /** loader 解析的模块 id，必须是本包包名。 */
  readonly name: string;
}

/** @returns `package.json` 的 `name`。 */
export function readPackageName(): string {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name?: unknown };
  if (typeof manifest.name !== 'string') throw new Error('package.json 里没有 name');
  return manifest.name;
}

/**
 * 读 bundle patch 里那条 insert 行。
 *
 * 不引 YAML 依赖：官方 patch 的形状是固定的（顶层一个数组、`- insert:` 下面缩进四格的字段），
 * 按它读比多背一个依赖划算。注释行先滤掉 —— 注释会正当地提到被否决的写法。
 *
 * @returns 行 id 与模块名。
 */
export function readPatchRow(): PatchRow {
  const source = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8');
  const lines = source.split('\n').filter((line) => !line.trimStart().startsWith('#'));
  const insertAt = lines.findIndex((line) => /^-\s*insert:\s*$/.test(line));
  if (insertAt < 0) throw new Error('cordis.patch.yml 里没有 insert 块');
  const fields = new Map<string, string>();
  for (const line of lines.slice(insertAt + 1)) {
    // 回到顶层 = insert 块结束。
    if (/^\S/.test(line)) break;
    // 字段既可能是 `    - id: x`（insert 本身是个列表项）也可能是 `      name: x`。
    const match = /^\s+(?:-\s+)?([a-zA-Z]+):\s*(\S+)\s*$/.exec(line);
    if (match !== null) fields.set(match[1]!, match[2]!);
  }
  const id = fields.get('id');
  const name = fields.get('name');
  if (id === undefined || name === undefined) throw new Error('cordis.patch.yml 的 insert 块里缺 id 或 name');
  return { id, name };
}
