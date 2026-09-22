/**
 * 发布前检查。
 *
 * 本仓库现在是**发布态**：`dsh.bundle.patch` 已声明、`private` 未设置。
 *
 * 为什么要有它：这几条「发布态该有什么」此前只写在 [docs/PUBLISHING.md](../docs/PUBLISHING.md)
 * 的前置条件里（散文）。规则住在散文里就没人执行 —— 所以 2026-09-20 落成脚本，
 * 由 `release.yml` 在发布前跑。
 *
 * 与 `dsh-ds-balance` 的同一脚本对齐：判断同一批发布态不变量，措辞可各自表述。
 */

import { existsSync, readFileSync } from 'node:fs';
import { inspectPluginMetadata } from './plugin-metadata.mjs';

const failures = [];
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

/** 断言一条发布态不变量。 */
function require_(label, ok, hint) {
  if (!ok) failures.push(`${label} —— ${hint}`);
}

require_(
  'dsh.bundle.patch',
  pkg.dsh?.bundle?.patch === './cordis.patch.yml',
  'bundle 层靠它进入 profile；开发期若被摘掉，发布前必须加回。',
);
require_('private', pkg.private !== true, '发布前要移除 "private": true。');
require_('engines.dsh', typeof pkg.engines?.dsh === 'string', '宿主兼容范围必须声明。');
require_('files 含 cordis.patch.yml', Array.isArray(pkg.files) && pkg.files.includes('cordis.patch.yml'), 'bundle 层依赖它。');
require_('LICENSE 存在', existsSync('LICENSE'), 'package.json 声明 MIT，仓库里必须有对应文件。');

// 展示元数据随包且可解析：locale/<lang>.json 必须被 exports 暴露、被 files 收录、字段非空。
// 缺任何一条宿主都不报错，只是插件页退回技术名 —— 静默故障，所以并进这道发布前守卫。
// 判定在一个地方，测试读同一份（scripts/plugin-metadata.mjs）。
for (const failure of inspectPluginMetadata('.').failures) failures.push(failure);

if (failures.length > 0) {
  console.error('release check failed:');
  for (const line of failures) console.error(`  - ${line}`);
  process.exit(1);
}
console.log('release check passed');
