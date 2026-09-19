/**
 * 红线守卫（把「约定」变成「可执行校验」）。
 *
 * 这些规则写在文档里会随时间长草；写成测试则每次 \`npm test\` 都会重新校验。
 * 每条 `it` 对应一条红线，另外几组（文档不抄实测值等）是与红线同级的可执行约定。
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createZhihuGlobalSearchTool } from '../src/tools/global-search.js';
import { createZhihuSearchTool } from '../src/tools/search.js';
import { createZhihuZhidaTool } from '../src/tools/zhida.js';
import { createState } from '../src/state.js';
import { envelope, jsonResponse, makeHarness } from './helpers.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  engines?: Record<string, string>;
};

/** 构造全部三个工具，用于检查模型可见面。 */
function allTools() {
  const harness = makeHarness(async () => jsonResponse(envelope({ HasMore: false, Items: [] })));
  return {
    tools: [createZhihuSearchTool(harness.deps), createZhihuGlobalSearchTool(harness.deps), createZhihuZhidaTool(harness.deps)],
    dispose: () => {
      harness.dispose();
    },
  };
}

describe('红线 1：@deepseek-ai/* 绝不进入 dependencies', () => {
  it('dependencies 为空或缺席', () => {
    const runtimeDeps = Object.keys(packageJson.dependencies ?? {});
    expect(runtimeDeps.filter((name) => name.startsWith('@deepseek-ai/'))).toEqual([]);
  });

  it('上下文相关包全部在 peerDependencies 与 devDependencies', () => {
    for (const name of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/schemastery']) {
      expect(Object.keys(packageJson.peerDependencies ?? {})).toContain(name);
      expect(Object.keys(packageJson.devDependencies ?? {})).toContain(name);
    }
  });

  it('peerDependencies 里的 @deepseek-ai 包在 devDependencies 中版本一致', () => {
    const peers = packageJson.peerDependencies ?? {};
    const devs = packageJson.devDependencies ?? {};
    for (const [name, range] of Object.entries(peers)) {
      if (!name.startsWith('@deepseek-ai/')) continue;
      expect(devs[name]).toBe(range);
    }
  });
});

describe('红线 2 & 3：呈现层与模型上下文严格隔离', () => {
  it('模型可见的 Markdown 不含任何 UI 卡片字段', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const value = { ok: true, query: 'q', question: 'q', model: 'm', answer: 'a', reasoning: '', items: [], hasMore: false };
      const blocks = tool.output.render({ query: 'q', question: 'q' }, value);
      const text = blocks.map((block) => ('text' in block ? block.text : '')).join('');
      expect(text).not.toContain('"card"');
      expect(text).not.toContain('"sources"');
      expect(text).not.toContain('presentationMeta');
    }
    dispose();
  });

  it('presentationMeta 连续两次调用结果完全相同（纯函数）', () => {
    const { tools, dispose } = allTools();
    const value = {
      ok: true,
      query: 'q',
      items: [{ title: 't', url: 'https://a', snippet: 's', author: 'a', voteUpCount: 1, contentType: 'Answer' }],
      hasMore: false,
    };
    for (const tool of tools) {
      if (tool.output.presentationMeta === undefined) continue;
      const first = JSON.stringify(tool.output.presentationMeta({ query: 'q' }, value));
      const second = JSON.stringify(tool.output.presentationMeta({ query: 'q' }, value));
      expect(first).toBe(second);
    }
    dispose();
  });
});

describe('红线 4：无可变全局状态', () => {
  it('两次 createState 完全隔离', () => {
    const a = createState({ cacheMaxEntries: 10, cacheTtlMs: 1000, searchPerMinute: 1, zhidaPerMinute: 1 });
    const b = createState({ cacheMaxEntries: 10, cacheTtlMs: 1000, searchPerMinute: 1, zhidaPerMinute: 1 });
    a.cache.set('k', 'v');
    expect(b.cache.get('k')).toBeUndefined();
    expect(a.searchBucket.tryConsume()).toBe(true);
    // a 的桶已空，但 b 的桶不受影响。
    expect(a.searchBucket.tryConsume()).toBe(false);
    expect(b.searchBucket.tryConsume()).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('dispose 会清空缓存', () => {
    const state = createState({ cacheMaxEntries: 10, cacheTtlMs: 60_000, searchPerMinute: 60, zhidaPerMinute: 10 });
    state.cache.set('k', 'v');
    state.dispose();
    expect(state.cache.get('k')).toBeUndefined();
  });

  it('插件入口是唯一接触 Cordis 的模块，且状态在 ctx.effect 内创建', () => {
    const index = readFileSync(root + 'src/index.ts', 'utf8');
    expect(index).toContain('ctx.effect(');
    expect(index).toContain('createState(');
    // 状态创建必须发生在 effect 回调内部，而不是 apply 顶层。
    const effectAt = index.indexOf('ctx.effect(');
    expect(index.indexOf('createState(')).toBeGreaterThan(effectAt);
  });

  it('源码里没有模块级 let 声明（可变全局的典型形态）', () => {
    const files = ['src/transport.ts', 'src/state.ts', 'src/utils/compiler.ts', 'src/utils/text.ts', 'src/utils/errors.ts'];
    for (const file of files) {
      const source = readFileSync(root + file, 'utf8');
      const topLevelLet = source.split('\n').filter((line) => /^(export )?let\s/.test(line));
      expect(topLevelLet, file).toEqual([]);
    }
  });

  it('凭据服务只能经 inject 取得，不得走 ctx.get 旁路', () => {
    // 只校验生效的代码行：注释里正当地提到被否决的写法（与 cordis.patch.yml 的校验同理）。
    const effective = readFileSync(root + 'src/index.ts', 'utf8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
      .join('\n');
    // `ctx.get` 按 cordis 文档是「不受 inject 约束的读取」—— 它绕过的是门禁，
    // 不是服务发现本身，跨挂载位置并不可靠。同一上下文里 `ctx.tools`（inject + 属性访问）
    // 一直正常，而 `ctx.get('credentials')` 在 1.6.0 的线上装配里拿不到服务：
    // 旧版有一条 `fromSettings` 兜底替它兜着，兜底一删，工具就集体「没有 key」。
    // 取凭据的唯一合法路径是 `ctx.inject(['credentials'], …)` + 属性访问。
    expect(effective, 'src/index.ts').not.toContain("ctx.get('credentials')");
  });
});

describe('红线 5：模型绝不接触知乎原始语法', () => {
  it('参数 schema 里不出现 SortBy / Filter / 知乎字段名', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const serialized = JSON.stringify(tool.parameters);
      for (const forbidden of ['SortBy', 'Filter', 'VoteUpCount', 'CommentCount', 'publish_time', 'host==', 'desc:(']) {
        expect(serialized, tool.name).not.toContain(forbidden);
      }
    }
    dispose();
  });

  it('排序字段以语义化名称暴露', () => {
    const { tools, dispose } = allTools();
    const search = tools.find((tool) => tool.name === 'zhihu_search');
    expect(JSON.stringify(search?.parameters)).toContain('voteUpCount');
    dispose();
  });

  it('每个工具的参数与输出 schema 都是封闭对象', async () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      const schema = tool.output.schema as { additionalProperties?: boolean };
      expect(schema.additionalProperties, tool.name).toBe(false);
    }
    dispose();
  });
});

describe('工具集不变量', () => {
  it('工具名唯一且带 zhihu_ 前缀', () => {
    const { tools, dispose } = allTools();
    const names = tools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
    for (const name of names) expect(name.startsWith('zhihu_')).toBe(true);
    dispose();
  });

  it('cordis.patch.yml 用可解析的包名，不用 @local/ 别名', () => {
    const patch = readFileSync(root + 'cordis.patch.yml', 'utf8');
    // 只校验生效的 YAML 行；注释里提到 @local/ 是在解释「为什么不这么写」。
    const effective = patch
      .split('\n')
      .filter((line) => !line.trimStart().startsWith('#'))
      .join('\n');
    expect(effective).not.toContain('@local/');
    expect(effective).toContain('name: dsh-zhihu-search');
  });


  it('每个工具都有真实的描述文本（模型靠它做工具选择）', () => {
    const { tools, dispose } = allTools();
    for (const tool of tools) {
      expect(tool.description.length, tool.name).toBeGreaterThan(30);
    }
    dispose();
  });
});

describe('文档不抄实测值', () => {
  /**
   * 记录类：写的就是当时的事实，**故意**带着会漂的值，所以不在约束范围内。
   * 判据是「它写的是此刻还是当时」—— 被当现状读的才算活文档。
   * 本仓的记录层只有两处：决策记录（.agents/notes/）与事故复盘（docs/postmortem/）。
   */
  const RECORDS = [/^\.agents\/notes\//, /^docs\/postmortem\//];

  /** 门面双件：装之前必须看得见兼容范围，所以允许留值 —— 但必须与真源同行。 */
  const FACADE = ['README.md', 'README_en.md'];

  /** 真源。留值的那一行必须自己写出处。 */
  const HOME = 'package.json';

  /**
   * 会漂的宿主版本字面量。
   * 形状跟着宿主主版本走：宿主换主版本号时下面那条「守卫跟着宿主线走」会红，来改这里。
   */
  const HOST_VERSION = /\b0\.\d+\.\d+(?:-[a-z]+\.\d+)?\b/g;

  /**
   * 会被当文档读的 markdown（相对仓库根）；跳过依赖、产物与版本库目录。
   *
   * @param dir - 相对仓库根的目录，空串表示仓库根。
   * @returns 相对仓库根的路径列表。
   */
  function liveDocs(dir = ''): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(root + dir, { withFileTypes: true })) {
      const path = dir === '' ? entry.name : dir + '/' + entry.name;
      if (entry.isDirectory()) {
        if (['node_modules', 'lib', '.git'].includes(entry.name)) continue;
        found.push(...liveDocs(path));
        continue;
      }
      if (!entry.name.endsWith('.md')) continue;
      if (RECORDS.some((pattern) => pattern.test(path))) continue;
      found.push(path);
    }
    return found;
  }

  it('活文档里不写会漂的宿主版本；门面要留就得与真源同行', () => {
    const files = [...liveDocs(), ...readdirSync(root + '.github/workflows').map((name) => '.github/workflows/' + name)];
    // 扫不到文件说明 walk 的路径规则坏了，先红这个，别让它静默变成一条永不触发的守卫。
    expect(files.length).toBeGreaterThan(10);

    for (const file of files) {
      const lines = readFileSync(root + file, 'utf8').split('\n');
      lines.forEach((line, index) => {
        for (const value of line.match(HOST_VERSION) ?? []) {
          if (FACADE.includes(file) && line.includes(HOME)) continue;
          throw new Error(
            file + ':' + (index + 1) + ' 抄了会漂的宿主版本 ' + value +
              ' —— 改成指向 ' + HOME + ' 的指针，或现查 npm view @deepseek-ai/dsh dist-tags',
          );
        }
      });
    }
  });

  it('守卫跟着宿主线走：宿主换主版本号时这条会红，来改 HOST_VERSION', () => {
    // 声明面写的是范围（下限 + 上界），所以形状判据落在下限上。
    expect(packageJson.engines?.['dsh'], '宿主已不在 0.x 线上，HOST_VERSION 的形状要跟着改')
      .toMatch(/(?:^|[>=\s])0\./);
  });
});
