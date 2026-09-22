/**
 * 设置接缝不变量（0.1.7-alpha.1 迁移的固化）。
 *
 * 这一组盯的是**两半体与仓内声明之间的对账**，而不是某一侧的行为：
 * 旧机制（`settingsScope` / `installSection`）一旦被谁顺手写回来，
 * 症状都是**静默**的 —— 卡片不出现、开关不生效，页面与控制台都不报错。所以写成会红的断言。
 *
 * **`plugins.bundle.config` 不在这张名单里**（2026-09-22 更正）：它是 0.1.6 与 0.1.7 **都有**的
 * 合法槽，本插件的配置卡片就注册在它上面，而 `plugins.row.config` 才是这次回退换掉的那个 ——
 * 把两者搞反会在运行时把一张好卡片判成违规。
 *
 * 全部从 `src/` 与仓内声明文件读，不 import 产物（产物面由
 * [client-bundle.test.ts](client-bundle.test.ts) 负责）。
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Config } from '../src/index.js';
import { readPackageName, readPatchRow } from './declaration.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/**
 * 去掉块注释与行注释，避免注释里的字样触发守卫。
 *
 * 只看**生效代码行**：注释里正当地提到被否决的写法（解释「为什么不那么写」），
 * 拿它判红会逼着人删掉解释。
 *
 * @param source - 源码文本。
 * @returns 去掉注释后的文本。
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** @param path - 相对仓库根的路径。 @returns 去掉注释的源码。 */
function effective(path: string): string {
  return stripComments(readFileSync(root + path, 'utf8'));
}

/** 0.1.7-alpha.1 起不再存在的服务名。声明它们 = inject 门禁不通过 = 整个 apply 不执行。 */
const REMOVED_SERVICES = ['settingsScope'];

describe('接缝不变量：客户端 inject', () => {
  it('不再声明任何已删服务名', () => {
    const source = effective('src/client/index.tsx');
    for (const service of REMOVED_SERVICES) {
      expect(source, `src/client/index.tsx 仍在提 ${service}`).not.toContain(service);
    }
  });

  it('全仓生效代码里都没有已删服务名（含宿主半体与脚本）', () => {
    // 两侧都要查：宿主半体曾经在 inject ['settings'] 里用 installSection，
    // 客户端在 inject 里等 settingsScope。漏掉任一侧，故障形态一样（静默不激活）。
    for (const path of ['src/index.ts', 'src/migrate.ts', 'scripts/build-client.mjs']) {
      const source = effective(path);
      for (const service of REMOVED_SERVICES) {
        expect(source, `${path} 仍在提 ${service}`).not.toContain(service);
      }
      expect(source, path).not.toContain('installSection');
    }
  });

  it('inject 声明的四要素一字不差（remote 与 remote.credentials 缺一不可）', () => {
    const source = effective('src/client/index.tsx');
    const match = /export const inject = (\[[^\]]*\]);/.exec(source);
    expect(match, 'src/client/index.tsx 里找不到 inject 声明').not.toBeNull();
    expect(JSON.parse(match![1]!.replace(/'/g, '"'))).toEqual(['slots', 'remote', 'remote.credentials', 'locale']);
  });
});

describe('接缝不变量：槽 key（包名）', () => {
  const packageName = readPackageName();
  const patchRow = readPatchRow();

  it('包名与 bundle patch 的模块名一致，且 patch 行有 id', () => {
    expect(patchRow.name).toBe(packageName);
    expect(patchRow.id.length).toBeGreaterThan(0);
  });

  it('BUNDLE_NAME 与 package.json 的 name 逐字相等', () => {
    // 产物里的 key 由 client-bundle 验；这里验**源码字面量** —— 两者都红才说明
    // 「改了 package.json，源码忘了跟」这件事一定被抓住。
    const source = effective('src/client/index.tsx');
    const bundleName = /const BUNDLE_NAME = '([^']+)';/.exec(source);
    expect(bundleName?.[1], 'src/client/index.tsx 的 BUNDLE_NAME').toBe(packageName);
  });

  it('槽名是 plugins.bundle.config，key = 包名（不是 <包名>#<行 id>）', () => {
    const source = effective('src/client/index.tsx');
    expect(source).toContain("ctx.slots.inject('plugins.bundle.config'");
    expect(source).toContain("name: 'plugins.bundle.config'");
    expect(source).toContain('key: BUNDLE_NAME');
    // 行配置槽是这次回退换掉的那一个：它才需要 <包名>#<行 id> 拼串，本插件不再注册它。
    expect(source).not.toContain("'plugins.row.config'");
  });
});

describe('接缝不变量：configForms.get() 的实参', () => {
  const patchRow = readPatchRow();

  it('取表单用的 entry id 逐字等于 bundle patch 那条 insert 的 id', () => {
    // 这是本设计唯一新引入的**静默耦合点**：槽 key 取包名、get() 取 loader entry id，
    // 两者今天同串但是两个不同的东西。改了 patch 的 id 之后槽 key 仍然对得上（卡片照常出现），
    // get() 却查不到命名空间 —— 卡片永远只读，**且不报错**。所以这里钉住源码字面量。
    const source = effective('src/client/index.tsx');
    const entryId = /const ENTRY_ID = '([^']+)';/.exec(source);
    expect(entryId?.[1], 'src/client/index.tsx 的 ENTRY_ID').toBe(patchRow.id);
  });

  it('get() 的实参就是那个常量，而不是就地写的一串字面量', () => {
    // 就地写死的话，上面那条对账会变成一句空话（它只验常量，不验调用点）。
    const source = effective('src/client/index.tsx');
    expect(source).toContain('.get(ENTRY_ID)');
    expect(source).not.toMatch(/\.get\(['"]/);
  });

  it('服务取用的是嵌套 ctx.inject，不进模块级 inject 门禁', () => {
    // 模块级 inject 是**激活门禁**：把 0.1.7 才有的 configForms 写进去，更早宿主上整个
    // 客户端半体 pending —— 字典、凭据订阅、探测连发声机会都没有。上一组已钉住四要素。
    const source = effective('src/client/index.tsx');
    expect(source).toContain("ctx.inject(['configForms']");
  });
});

describe('接缝不变量：schema 的 volatile 字段恰好两个', () => {
  const dict = (Config as unknown as { dict: Record<string, { meta?: { volatile?: boolean; role?: string } }> }).dict;

  it('volatile 集合 == {accessSecretRef, disableNativeWebSearch}', () => {
    // 只有 volatile 字段会进 describe 的 value/base/user —— 少一个，卡片上那一格就永远是空的；
    // 多一个，就把不该下行的值搬上了下行线路。两边都要拦。
    const volatileFields = Object.entries(dict)
      .filter(([, schema]) => schema.meta?.volatile === true)
      .map(([key]) => key)
      .sort();
    expect(volatileFields).toEqual(['accessSecretRef', 'disableNativeWebSearch']);
  });

  it('密钥字段绝不 volatile（它结构上不能进表单）', () => {
    expect(dict['accessSecret']?.meta?.role).toBe('secret');
    expect(dict['accessSecret']?.meta?.volatile).not.toBe(true);
  });
});

describe('接缝不变量：loader 事件与配置页策略', () => {
  it('loader/volatile-update 的监听与它的类型导入都在位', () => {
    const source = effective('src/index.ts');
    // 少了 import，监听以 TS2345 报「键不在 keyof Events 里」；少了监听，开关拨完不生效。
    expect(source).toContain("import type {} from '@deepseek-ai/cordis-plugin-loader'");
    expect(source).toContain("ctx.on('loader/volatile-update'");
  });

  it('配置页策略走 settings.configure，而不是已删的 installSection', () => {
    const source = effective('src/index.ts');
    expect(source).toContain('settings.configure({ auto: false }, ctx.fiber)');
    expect(source).toContain("ctx.inject(['settings']");
  });
});
