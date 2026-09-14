#!/usr/bin/env node
/**
 * 验收脚本：对**指定安装目录**的构建产物做端到端验收（打真实知乎接口）。
 *
 * 为什么要有它：工具的行为只有走「真实接口 + 宿主校验器」才能验完 —— 单元测试读的是
 * `execute()` 的返回值，既不过宿主那道 `output.schema` 校验，也拿不到模型可见文本。
 * v1.4.0 的 P0 正是这样漏过去的（见 docs/postmortem/2026-09-14-output-schema-drift.md）。
 *
 * 用法：
 *   ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs                 # 默认验本机 profile 里装的那份
 *   ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs .               # 验仓库自身的构建产物
 *   ZHIHU_ACCESS_SECRET=xxx node scripts/acceptance.mjs <包目录>
 *
 * 退出码：0 = 全部通过；1 = 有未通过项；2 = 缺少凭据。
 * 不进 CI：花真实配额，且验的是「本机装的那份」。
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateJsonSchemaValue } from '@deepseek-ai/dsh-tools';

const secret = (process.env.ZHIHU_ACCESS_SECRET ?? '').trim();
if (secret === '') {
  console.error('缺少 ZHIHU_ACCESS_SECRET：验收要打真实接口。');
  process.exit(2);
}

/** 本机 profile 里安装的那份（真机验收的默认目标）。 */
const PROFILE_COPY = join(homedir(), '.dsh', 'profiles', 'web', 'node_modules', 'dsh-zhihu-search');
const target = resolve(process.argv[2] ?? (existsSync(PROFILE_COPY) ? PROFILE_COPY : '.'));
const version = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')).version;
const load = (rel) => import(pathToFileURL(join(target, rel)).href);

const { ZhihuClient } = await load('lib/transport.js');
const { createZhihuSearchTool } = await load('lib/tools/search.js');
const { createZhihuGlobalSearchTool } = await load('lib/tools/global-search.js');
const { renderSearch } = await load('lib/present/search.js');
const { compileFilter } = await load('lib/utils/compiler.js');
const { createState } = await load('lib/state.js');

const state = createState({ cacheMaxEntries: 50, cacheTtlMs: 60_000, searchPerMinute: 60, zhidaPerMinute: 10 });
const client = new ZhihuClient({ accessSecret: secret, baseUrl: 'https://developer.zhihu.com' });
const deps = {
  client,
  cache: state.cache,
  baseUrl: 'https://developer.zhihu.com',
  credentialId: () => 'acceptance',
  streamTimeoutMs: client.streamTimeoutMs,
  searchBucket: state.searchBucket,
  zhidaBucket: state.zhidaBucket,
};
const exec = { signal: new AbortController().signal };
const textOf = (blocks) => blocks.map((block) => block.text ?? '').join('\n');
const schemaErrors = (tool, value) => validateJsonSchemaValue(tool.output.schema, value);

let failed = 0;
const check = (label, ok, detail) => {
  if (!ok) failed += 1;
  console.log(`${ok ? '✅' : '❌'} ${label}${detail === undefined ? '' : ` —— ${detail}`}`);
};

console.log(`验收目标：${target}\n版本：dsh-zhihu-search@${version}\n`);

// ── 验收 1：下限只在候选内筛选，插件按端点上限扩池 ────────────────
{
  const search = createZhihuSearchTool(deps);
  const args = { query: 'RAG', minValue: 100, count: 3, sortField: 'voteUpCount' };
  const value = await search.execute(args, exec);
  const votes = value.items.map((item) => item.voteUpCount ?? -1);
  check('A1 扩池：返回条目全部满足下限', value.ok && votes.length > 0 && votes.every((v) => v >= 100), `条数 ${value.items.length}，点赞 ${JSON.stringify(votes)}`);
  check('A1 输出通过宿主 schema 校验', schemaErrors(search, value).length === 0, schemaErrors(search, value).join('; '));

  const shortArgs = { query: '大模型', minValue: 500, count: 5, sortField: 'voteUpCount' };
  const shortValue = await search.execute(shortArgs, exec);
  const text = textOf(search.output.render(shortArgs, shortValue));
  check('A1 筛少时说明「下限只筛本次候选」', text.includes('只在本次检索到的候选中'), text.split('\n').filter((l) => l.includes('筛出')).join(' '));
}

// ── 验收 2：输出面与排序档位对称 ─────────────────────────────────
{
  const search = createZhihuSearchTool(deps);
  const args = { query: '大模型', sortField: 'commentCount', count: 3 };
  const value = await search.execute(args, exec);
  const complete = value.items.length > 0 && value.items.every((item) => typeof item.commentCount === 'number' && typeof item.editTime === 'number');
  check('A2 每条都带评论数与时间', complete, value.items.map((i) => `c=${i.commentCount},t=${i.editTime}`).join(' | '));
  check('A2 输出通过宿主 schema 校验', schemaErrors(search, value).length === 0, schemaErrors(search, value).join('; '));
  const text = textOf(search.output.render(args, value));
  check('A2 渲染出评论与时间', text.includes('**评论**') && text.includes('**时间**'));
}

// ── 验收 3：site 归一化（剥 www.）与整串精确匹配 ──────────────────
{
  const compiled = compileFilter({ site: 'www.github.com' });
  check('A3 www. 被归一化', compiled === 'host=="github.com"', String(compiled));

  const global = createZhihuGlobalSearchTool(deps);
  const args = { query: 'DeepSeek Harness', count: 5, site: 'www.github.com' };
  const value = await global.execute(args, exec);
  const hosts = value.items.map((item) => { try { return new URL(item.url).host; } catch { return '?'; } });
  check('A3 真机返回 github.com 的结果（旧版为 0 条）', value.ok && value.items.length > 0 && hosts.every((h) => h === 'github.com'), `条数 ${value.items.length}，hosts ${JSON.stringify([...new Set(hosts)])}`);
  check('A3 输出通过宿主 schema 校验', schemaErrors(global, value).length === 0, schemaErrors(global, value).join('; '));
}

console.log(failed === 0 ? '\n全部通过。' : `\n${failed} 项未通过。`);
state.dispose();
process.exit(failed === 0 ? 0 : 1);
