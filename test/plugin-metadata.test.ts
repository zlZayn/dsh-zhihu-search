/**
 * 插件展示元数据（`locale/<lang>.json` 的 `meta`）不变量。
 *
 * 这一组盯的是**宿主读不到标题与描述时会怎样**：它**不报错** ——
 * 插件页与设置里的插件清单直接退回技术名（`dsh-zhihu-search` / `zhihu-search`），
 * 中文文案一个字都不出现。三条静默路径，各写一条断言：
 *
 * - `locale/en.json` 不在包内 → 宿主连发现入口都没有（*随包*）；
 * - `exports` 没有 `./locale/*.json` → 按 `<包名>/locale/en.json` 解析拿到
 *   `ERR_PACKAGE_PATH_NOT_EXPORTED`，同样只是回落（*可解析*）；
 * - 字段缺失、空白或 JSON 写坏 → 只回落到下一档（`package.json.name` → 完整 Cordis 名）。
 *
 * 判定本身住在 [scripts/plugin-metadata.mjs](../scripts/plugin-metadata.mjs)，
 * `npm run check:release` 读**同一份**（避免守卫与测试各写一套判定，红了只红一边）。
 * 机制与回落链的出处：DSH `docs/cookbook/adding-a-package.md` 的
 * 「5. Add optional plugin display metadata」、`packages/boot/app-boot/src/package-meta.ts`。
 * 为什么这么定、为什么不加图标 → [决策记录](../.agents/notes/2026-09-22-plugin-display-metadata.md)。
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
// 类型面由 [../scripts/plugin-metadata.d.mts](../scripts/plugin-metadata.d.mts) 提供（手写，改实现时同批改）。
import { displayMetadata, inspectPluginMetadata, readManifest, type Manifest } from '../scripts/plugin-metadata.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** 这一组期间临时建出来的仓副本；每个用例结束后删掉。 */
const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * 造一棵「只差一处」的仓副本：清单与 locale 目录都从本仓抄，再按需改写。
 *
 * 用真副本而不是内存对象，是因为守卫**故意从目录读语言文件**
 * （宿主的发现入口就是「en.json 所在目录里的所有 .json」），
 * 给它塞一份内存清单就测不到那条路径了。
 *
 * @param mutate - 就地改写副本的钩子。
 * @returns 副本的根目录。
 */
function fixture(mutate: (dir: string) => void): string {
  const dir = mkdtempSync(join(tmpdir(), 'zhihu-metadata-'));
  fixtures.push(dir);
  mkdirSync(join(dir, 'locale'));
  for (const language of ['en', 'zh']) {
    writeFileSync(join(dir, 'locale', `${language}.json`), readFileSync(join(root, 'locale', `${language}.json`)));
  }
  // 清单先照抄本仓那份：只改一处，红了才说明是那一处引起的。
  writeFileSync(join(dir, 'package.json'), JSON.stringify(readManifest(root), null, 2));
  mutate(dir);
  return dir;
}

/**
 * 把一个对象写成副本里的 `package.json`。
 *
 * @param dir - 副本根目录。
 * @param manifest - 要写进去的清单对象。
 */
function writeManifest(dir: string, manifest: Manifest): void {
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

/**
 * 副本应有的失败条目，按标签取；取不到就报出全部条目，免得只看到一句「undefined」。
 *
 * @param dir - 副本根目录。
 * @param label - 期望出现的判定名（用 `toContain` 匹配，避免把提示文案也钉住）。
 * @returns 命中的失败提示。
 */
function failureFor(dir: string, label: string): string | undefined {
  const { failures } = inspectPluginMetadata(dir);
  return failures.find((entry) => entry.includes(label)) ?? (failures.length === 0 ? undefined : failures.join('\n'));
}

describe('展示元数据：宿主读得到（本仓现状）', () => {
  const { failures, titles, descriptions, languageIds } = inspectPluginMetadata(root);
  const meta = readManifest(root);

  it('随包与可解析的判定全部通过（导出面、files、语言文件形状）', () => {
    expect(failures).toEqual([]);
  });

  it('两种语言都在，且标题与描述都是非空字符串', () => {
    expect(languageIds).toEqual(['en', 'zh']);
    for (const language of languageIds) {
      expect(typeof titles[language], language).toBe('string');
      expect(typeof descriptions[language], language).toBe('string');
      expect(titles[language]!.trim().length, language).toBeGreaterThan(0);
      expect(descriptions[language]!.trim().length, language).toBeGreaterThan(0);
    }
  });

  it('中英两份不是同一串（中文那页没抄英文）', () => {
    // 不是风格判据，是**漏译判据**：两份文件内容相同时最可能的写法是复制英文那份。
    expect(titles.zh).not.toBe(titles.en);
    expect(descriptions.zh).not.toBe(descriptions.en);
  });

  it('标题与描述都不含 npm 作用域名与包名前缀（展示面不该出现技术名）', () => {
    for (const language of languageIds) {
      for (const text of [titles[language]!, descriptions[language]!]) {
        expect(text).not.toContain('@deepseek-ai/');
        expect(text).not.toContain('dsh-zhihu-search');
      }
    }
  });

  it('包级 description 与英文描述同源同内容（回落链的中间那档）', () => {
    // 描述回落是 meta.description → package.json.description：两档不一致时，
    // 英文界面与 npm 页面会讲两套话，而两处都不会红。
    expect(meta.description).toBe(descriptions.en);
  });

  it('未声明图标（可选字段；判定见决策记录，不是遗漏）', () => {
    expect(meta.icon).toBeUndefined();
    expect(displayMetadata(root, 'en')?.title).toBe(titles.en);
  });
});

describe('展示元数据守卫：反向控制', () => {
  it('files 漏掉 locale/*.json 时红，且报的是那一条', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      manifest.files = manifest.files.filter((entry) => entry !== 'locale/*.json');
      writeManifest(target, manifest);
    });
    const failure = inspectPluginMetadata(dir).failures;
    expect(failure.some((entry) => entry.includes('files 收录 locale/en.json'))).toBe(true);
    expect(failure.some((entry) => entry.includes('files 收录 locale/zh.json'))).toBe(true);
  });

  it('exports 少 ./locale/*.json 时红 —— 这是宿主解析不到的那条（ERR_PACKAGE_PATH_NOT_EXPORTED）', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      delete manifest.exports['./locale/*.json'];
      writeManifest(target, manifest);
    });
    const failure = inspectPluginMetadata(dir).failures;
    expect(failure.some((entry) => entry.includes('exports 暴露 dsh-zhihu-search/locale/en.json'))).toBe(true);
  });

  it('exports 少 ./package.json 时红（包级回落与图标声明都经它读）', () => {
    const dir = fixture((target) => {
      const manifest = readManifest(root);
      delete manifest.exports['./package.json'];
      writeManifest(target, manifest);
    });
    expect(failureFor(dir, 'exports 暴露 ./package.json')).toBeDefined();
  });

  it('字段为空串、缺字段或 JSON 写坏时红（宿主只回落，不报错）', () => {
    const blank = fixture((target) => writeFileSync(join(target, 'locale', 'zh.json'), JSON.stringify({ meta: { title: '   ' } })));
    expect(failureFor(blank, 'locale/zh.json 有非空 meta.title')).toBeDefined();
    expect(failureFor(blank, 'locale/zh.json 有非空 meta.description')).toBeDefined();

    const broken = fixture((target) => writeFileSync(join(target, 'locale', 'zh.json'), '{ "meta": '));
    expect(failureFor(broken, 'locale/zh.json 不是合法 JSON')).toBeDefined();
  });

  it('文件名不是语言 id 时红，且不把缺语言的那条一起报出来', () => {
    const dir = fixture((target) => writeFileSync(join(target, 'locale', 'not_a_language.json'), JSON.stringify({ meta: {} })));
    const { failures } = inspectPluginMetadata(dir);
    expect(failures.some((entry) => entry.includes('not_a_language.json 是合法语言 id'))).toBe(true);
    // 反向控制的反向：这一处改动不该让「随包」那几条跟着红 —— 否则红了也定位不到真正的原因。
    expect(failures.some((entry) => entry.includes('files 收录 locale/not_a_language.json'))).toBe(false);
  });

  it('icon 声明越界或写成绝对路径时红，未声明则通过', () => {
    for (const icon of ['../assets/logo.svg', '/opt/logo.svg', 'C:\\logo.svg', 'https://example.com/logo.svg', '']) {
      const dir = fixture((target) => {
        const manifest = readManifest(root);
        manifest.icon = icon;
        writeManifest(target, manifest);
      });
      expect(failureFor(dir, 'icon 声明在主清单目录内'), icon).toBeDefined();
    }

    // 未声明图标（本仓现状）：这一条不该红。
    expect(failureFor(fixture(() => undefined), 'icon 声明在主清单目录内')).toBeUndefined();
  });
});
