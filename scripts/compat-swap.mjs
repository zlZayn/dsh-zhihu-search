#!/usr/bin/env node
/**
 * compat 换包：把 DSH 依赖的**声明区间**就地换成某条 dist-tag 线（next / alpha）上的精确版本。
 *
 * 用法：
 *   node scripts/compat-swap.mjs check  next    # 声明面检查：只读，不装任何东西
 *   node scripts/compat-swap.mjs swap   alpha   # 就地改写 package.json，供随后的裸 npm install 用
 *   node scripts/compat-swap.mjs verify alpha   # 确认装出来的**真的是**那条线
 *
 * ## 为什么是「改写 package.json + 裸 npm install」，而不是 `npm install <包>@<tag>`
 *
 * 后者会清空某个**恰好没被点名**的包的目录。2026-09-16 在 npm 12.0.1 上实测：
 * 点名 18 个包时 dsh-client-locale 被清空，点名另外 17 个时 dsh-client-ui-primitives 被清空 ——
 * 目录还在、里面是空的，随后 typecheck 报「找不到模块」，是一个与上游毫无关系的**假红**。
 * 改写 package.json 之后跑**裸** `npm install` 不复现（实测 emptyDirs=0、18 个测试文件全绿）。
 *
 * 顺带的好处：peer 与 dev **同步**改写，所以既不需要 `--force`，也不需要 `--legacy-peer-deps`。
 * 后者尤其不能用：它会把 npm 的 **peer 自动安装**一起关掉，于是 dsh-tools 自己的 peer
 * （dsh-sandbox / dsh-sandbox-policy / dsh-ptc-runtime）一个都不装，测试以
 * 「Cannot find package '@deepseek-ai/dsh-sandbox'」假红 —— 实测 6 个测试文件失败。
 *
 * ## 谁参与换包
 *
 * 只有 `@deepseek-ai/dsh-*`。`@deepseek-ai/cordis` 与 `@deepseek-ai/schemastery` 除外：
 * 它们的 `next` 标签**比 latest 旧**（cordis next=4.0.1-rc.4 < latest=4.0.2，
 * schemastery next=3.18.1-rc.4 < latest=3.18.2），套 tag 会把它们降级到声明范围之外。
 *
 * 某个包在该 tag 上没有版本时：
 *   - 它出现在 `peerDependencies` → **失败**（声明面点名了一条线上不存在的版本）；
 *   - 它只是 `devDependencies` → 告警并跳过。当前的例子是 `dsh-code-runtime`：
 *     它的 alpha 停在 0.1.5-alpha.2（比 next 的 0.1.5-rc.2 还旧），且仓库里没有任何文件引用它。
 *
 * ## 为什么必须有 verify
 *
 * 2026-09-16 实测到一个会**假绿**的失败模式：`npm install` 因为上游包之间的 peer 冲突
 * 直接失败（exit 1），而 node_modules 原封不动地停在旧版本上；随后 typecheck 与 260 个测试
 * 全绿 —— 整条线报「兼容」，实际上一个 alpha 包都没装。所以换包之后必须**断言装出来的版本
 * 就是 tag 上的版本**，断言不过就红。宁可红得难看，也不要绿得骗人。
 *
 * ## check 判据与其边界
 *
 * `M` = 我们声明的区间所能取到的**最新**已发布版本；`T` = 该 tag 指向的版本。
 * `M === T` ⇒ T 一定落在区间内（M 按构造满足区间），**充分**。
 * `M !== T` 有两种可能：T 已在区间之外（要处理），或 T 落在区间内但不是最新的（tag 落后，也值得看一眼）。
 * 两种情况都该人工复核，所以一律判红。已知盲区：拿不准时它会喊，不会静默放过。
 *
 * 退出码：0 = 通过；1 = 失败；2 = 用法错误。
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

/** 只换 DSH 自己的包；理由见文件头。 */
const SWAP_PREFIX = '@deepseek-ai/dsh-';

/** 读版本一律打官方源：镜像可能落后，落后就会把「线还没动」误报成结论。 */
const REGISTRY = 'https://registry.npmjs.org/';

const COMMANDS = ['check', 'swap', 'verify'];
const [command, tag] = process.argv.slice(2);
if (!COMMANDS.includes(command) || tag === undefined) {
  console.error('用法：node scripts/compat-swap.mjs <check|swap|verify> <next|alpha>');
  process.exit(2);
}

/**
 * 问 npm 一个包的版本。
 *
 * @param {string} spec - `名字@范围或标签`。
 * @returns {string | undefined} 解析出的版本；取不到时 `undefined`。
 */
function resolveVersion(spec) {
  let raw;
  try {
    // 用裸名 'npm'：Windows 上 .cmd 不能被无 shell 地 spawn（Node 的 EINVAL 防护），
    // 而裸名在两侧都能解析到正确的可执行文件。stderr 一律丢弃（本机 npm 会往里写配置告警）。
    raw = execFileSync('npm', ['view', spec, 'version', '--json', '--registry=' + REGISTRY], { encoding: 'utf8' });
  } catch {
    return undefined;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return undefined;
  }
  if (Array.isArray(parsed)) return parsed.length === 0 ? undefined : String(parsed[parsed.length - 1]);
  return parsed === undefined || parsed === null ? undefined : String(parsed);
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const peers = manifest.peerDependencies ?? {};
const devs = manifest.devDependencies ?? {};

const targets = [...new Set([...Object.keys(peers), ...Object.keys(devs)])].filter((name) => name.startsWith(SWAP_PREFIX));
if (targets.length === 0) {
  console.error('::error::没有找到任何 ' + SWAP_PREFIX + '* 依赖：package.json 的声明面变了？');
  process.exit(2);
}

if (command === 'check') {
  console.log('声明面检查（线：' + tag + '，' + String(targets.length) + ' 个包）');
  let stale = 0;
  for (const name of targets) {
    const declared = peers[name] ?? devs[name];
    const tagVersion = resolveVersion(name + '@' + tag);
    const maxSatisfying = resolveVersion(name + '@' + declared);
    if (tagVersion === undefined) {
      console.log('  ??  ' + name + '：' + tag + ' 线上没有版本');
      stale += 1;
      continue;
    }
    if (maxSatisfying === undefined) {
      console.log('  ??  ' + name + '：声明的 ' + declared + ' 取不到任何已发布版本');
      stale += 1;
      continue;
    }
    const ok = maxSatisfying === tagVersion;
    console.log('  ' + (ok ? 'ok ' : '红 ') + ' ' + name + '：声明 ' + declared + ' 最新可取 ' + maxSatisfying + '，' + tag + ' = ' + tagVersion);
    if (!ok) stale += 1;
  }
  if (stale > 0) {
    console.error('');
    console.error('::error::有 ' + String(stale) + ' 个声明已罩不住 ' + tag + ' 线：使用者按当前 tag 装到的宿主落在我们声明的范围之外。');
    console.error('处理：核对上游变更后放宽 peer 范围并同步 README 的前置版本；范围放宽不改行为，按 docs/PUBLISHING.md 的 Q1/Q2 全否 → patch。');
    process.exit(1);
  }
  console.log('声明面仍罩得住 ' + tag + ' 线。');
  process.exit(0);
}

if (command === 'verify') {
  console.log('核对换包结果（线：' + tag + '，' + String(targets.length) + ' 个包）');
  let wrong = 0;
  for (const name of targets) {
    const version = resolveVersion(name + '@' + tag);
    if (version === undefined) {
      console.log('::warning::' + name + ' 在 ' + tag + ' 线上没有版本，无从核对（swap 时也应已跳过）。');
      continue;
    }
    let installed;
    try {
      installed = JSON.parse(readFileSync('node_modules/' + name + '/package.json', 'utf8')).version;
    } catch {
      installed = undefined;
    }
    if (installed !== version) {
      console.log('  红  ' + name + '：应为 ' + version + '，实装 ' + String(installed));
      wrong += 1;
    } else {
      console.log('  ok  ' + name + '：' + String(installed));
    }
  }
  if (wrong > 0) {
    console.error('');
    console.error('::error::有 ' + String(wrong) + ' 个包没有真正换到 ' + tag + ' 线 —— 换包那一步失败了，而旧版本的树会让测试全绿。');
    console.error('先看 npm install 的输出：多半是上游包之间的 peer 冲突，需要清掉旧树重装。');
    process.exit(1);
  }
  console.log('确认：' + String(targets.length) + ' 个包都真的在 ' + tag + ' 线上。');
  process.exit(0);
}

console.log('换包（线：' + tag + '，' + String(targets.length) + ' 个包）');
const skipped = [];
for (const name of targets) {
  const version = resolveVersion(name + '@' + tag);
  if (version === undefined) {
    if (peers[name] !== undefined) {
      console.error('::error::' + name + ' 是 peerDependency，却在 ' + tag + ' 线上没有版本 —— 声明面点名了一个不存在的版本。');
      process.exit(1);
    }
    console.log('::warning::' + name + ' 在 ' + tag + ' 线上没有版本，跳过（它只是 devDependency）。');
    skipped.push(name);
    continue;
  }
  console.log('  ' + name + '：' + (peers[name] ?? devs[name]) + ' → ' + version);
  if (peers[name] !== undefined) peers[name] = version;
  if (devs[name] !== undefined) devs[name] = version;
}
if (skipped.length > 0) console.log('跳过 ' + String(skipped.length) + ' 个：' + skipped.join(', '));

writeFileSync('package.json', JSON.stringify(manifest, null, 2) + '\n');
console.log('package.json 已改写。接着跑：npm install --ignore-scripts');
process.exit(0);
