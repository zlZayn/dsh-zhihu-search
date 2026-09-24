#!/usr/bin/env node
/**
 * 声明面检查：只读 `package.json` 的声明区间 + 问 npm，回答「我们声明的范围还罩不罩得住」。
 *
 * 判据：**声明的区间必须能覆盖我们告诉用户去装的那条线**（README 的「版本兼容」章节点名的那条
 * dist-tag 线，本文件用 TRACKED_LINE 记着）。覆盖不到就是红。
 *
 * 为什么单独成一步：它只读文件与 registry，几十秒出结果；与「换到那条线上还构不构得出来」
 * 是两件事，混在一起会互相遮蔽。所以本脚本**不装任何依赖**，只问 npm。
 *
 * 为什么要问 npm 而不是自己算：区间是否成立的权威是 npm 自己的 semver 实现，
 * 尤其是预发布段的规则 —— 一个 caret 区间罩得住同一个 major.minor.patch 里的预发布版本，
 * 却罩不住下一个补丁位的预发布版本。自己写一套等于制造假绿。
 * 问法是 `npm view <pkg>@<range> version --json`：它回的是该区间**全部**匹配版本，
 * 于是「那条线的版本在不在列表里」就是精确判定。
 *
 * 用法：
 *   node scripts/check-declaration.mjs                 # 用 TRACKED_LINE
 *   node scripts/check-declaration.mjs --line next     # 换一条线判
 *
 * 退出码：0 = 声明罩得住 / 1 = 有罩不住的 / 2 = 用法或前置条件缺失（网络、npm 找不到）
 *
 * 输出全英文、前缀 [INFO] / [WARN] / [NOTE]（与 dsh-ds-balance 的同名脚本同一套判据与输出面）。
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 我们告诉用户去装的那条 dist-tag 线。README 的「版本兼容」章节与它对齐。
 * 这是一条**线名**不是版本号 —— 会漂的是版本，现查即可，所以不写在这里。
 * 2026-09-24：宿主把新线发在 `next`（`0.1.7-rc.2`），声明面随之从 `alpha` 迁到 `next`。
 */
export const TRACKED_LINE = 'next'

/** 声明面里的宿主本体：`engines.dsh` 描述的就是它。 */
const HOST_PACKAGE = '@deepseek-ai/dsh'

/** 受管的平台包前缀；与 compat-swap.mjs 同一条边界。 */
const MANAGED_PREFIX = '@deepseek-ai/dsh-'

/** 声明区间可能出现的位置。 */
const MANIFEST_FIELDS = ['dependencies', 'devDependencies', 'peerDependencies']

/** 用于上下文对照的三条线。 */
const LINES = ['alpha', 'next', 'latest']

const USAGE = `usage:
  node scripts/check-declaration.mjs [--line <${LINES.join('|')}>]

exit codes: 0 = the declaration covers the line / 1 = it does not / 2 = usage or precondition error`

const tagsCache = new Map()

/**
 * 找 npm 的 CLI 入口，直接用当前 node 跑它。
 * 不走 shell：区间里的 `^` 与 `>` 是 shell 元字符，经 shell 传参会改义（Windows 上 `^` 是转义符）。
 * @returns npm-cli.js 的绝对路径。
 */
function npmCli() {
  const execDir = dirname(process.execPath)
  const candidates = [
    process.env.npm_execpath,
    join(execDir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    join(execDir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  ].filter((value) => typeof value === 'string' && value.length > 0)
  const found = candidates.find((value) => existsSync(value))
  if (!found) {
    throw new Error('cannot locate the npm CLI entry (npm-cli.js) next to node; run inside a node install that ships npm')
  }
  return found
}

/**
 * 问 npm：这个区间匹配哪些版本。
 * @param name - 包名。
 * @param range - 声明区间。
 * @returns 匹配到的版本列表；npm 明确回答「区间内没有版本」时返回空数组。
 */
function matchingVersions(name, range) {
  const result = spawnSync(process.execPath, [npmCli(), 'view', `${name}@${range}`, 'version', '--json'], {
    encoding: 'utf8',
  })
  if (result.error) throw result.error
  const stderr = result.stderr ?? ''
  // npm 对「区间内没有任何版本」用的是 E404 + 这句；别的失败（网络、registry）必须炸出来，
  // 不能伪装成「罩不住」—— 那会把基础设施故障读成声明问题。
  if (result.status !== 0) {
    if (stderr.includes('No match found for version')) return []
    throw new Error(`npm view ${name}@${range} failed: ${stderr.trim().split('\n').slice(0, 3).join(' ')}`)
  }
  const parsed = JSON.parse(result.stdout)
  return Array.isArray(parsed) ? parsed : [parsed]
}

/**
 * 从 registry 读一个包的 dist-tags（不调 npm view：这里是纯 HTTP，也更快）。
 * @param name - 包名。
 * @returns dist-tag 到版本的表。
 */
async function distTags(name) {
  if (tagsCache.has(name)) return tagsCache.get(name)
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { accept: 'application/vnd.npm.install-v1+json' },
  })
  if (!response.ok) throw new Error(`registry answered ${response.status} for ${name}`)
  const tags = (await response.json())['dist-tags'] ?? {}
  tagsCache.set(name, tags)
  return tags
}

/**
 * 清单里的声明面：宿主本体的 `engines.dsh`，加上三个依赖段里每个受管平台包的区间。
 * @param manifest - 解析后的 package.json。
 * @returns 逐条声明，`where` 指明它写在哪儿。
 */
function declarations(manifest) {
  const found = []
  const enginesDsh = manifest.engines?.dsh
  if (typeof enginesDsh === 'string') {
    found.push({ where: 'engines.dsh', name: HOST_PACKAGE, range: enginesDsh })
  }
  for (const field of MANIFEST_FIELDS) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (!name.startsWith(MANAGED_PREFIX)) continue
      if (typeof range !== 'string') continue
      found.push({ where: field, name, range })
    }
  }
  return found
}

/**
 * 跑一次检查。
 * @param line - 要判的 dist-tag 线。
 * @returns 进程退出码。
 */
async function check(line) {
  const manifest = JSON.parse(readFileSync('package.json', 'utf8'))
  const decls = declarations(manifest)
  if (decls.length === 0) throw new Error('package.json declares no dsh compatibility range at all')

  console.log(`[INFO] tracked line: ${line} (the dist-tag line the README's version-compatibility section names)`)

  // 上下文：三条线现在各指向什么。只有被跟的那条会因为「罩不住」变红。
  const names = [...new Set(decls.map((entry) => entry.name))].sort()
  for (const name of names) {
    const tags = await distTags(name)
    const cells = LINES.map((candidate) => `${candidate}=${tags[candidate] ?? '-'}`).join('  ')
    console.log(`[INFO] ${name}  ${cells}`)
  }

  const lineVersions = new Map()
  for (const name of names) {
    const version = (await distTags(name))[line]
    if (typeof version !== 'string') throw new Error(`${name} has no ${line} dist-tag`)
    lineVersions.set(name, version)
  }

  const uncovered = []
  for (const entry of decls) {
    const version = lineVersions.get(entry.name)
    const matches = matchingVersions(entry.name, entry.range)
    if (matches.includes(version)) {
      console.log(`[INFO] ${entry.where} declares ${entry.range} for ${entry.name} — covers ${version}`)
      continue
    }
    uncovered.push(entry)
    console.log(`[WARN] ${entry.where} declares ${entry.range} for ${entry.name} — does NOT cover ${version}`)
  }

  // 判据落在被跟的那条线上，而不是 `latest`：宿主 `latest` 指向的版本比被跟的线还旧
  // （README 的安装一节因此要求显式点名版本线）。`latest` 更旧这件事是实测出来的，
  // 所以这里现比一次、打印出来，而不是把结论写死。
  const hostTags = await distTags(HOST_PACKAGE)
  if (hostTags.latest !== undefined && hostTags.latest !== hostTags[line]) {
    console.log(`[NOTE] ${HOST_PACKAGE} latest=${hostTags.latest} differs from ${line}=${hostTags[line]}; the judgement is on the ${line} line.`)
  }

  if (uncovered.length === 0) {
    console.log(`[NOTE] declaration check passed: all ${decls.length} declared ranges cover the ${line} line`)
    return 0
  }
  console.log(`[WARN] declaration check failed: ${uncovered.length} of ${decls.length} declared ranges do not cover the ${line} line`)
  console.log('[NOTE] update the declared ranges in package.json to a version you actually tested, or move the tracked line.')
  return 1
}

function usageError(message) {
  if (message) console.error(`[WARN] ${message}`)
  console.error(USAGE)
  process.exit(2)
}

function parseLine(argv) {
  const index = argv.indexOf('--line')
  if (index === -1) return TRACKED_LINE
  const line = argv[index + 1]
  if (!line) usageError('--line needs a dist-tag after it')
  if (!LINES.includes(line)) usageError(`unknown dist-tag: ${line}`)
  return line
}

/** 只有被当命令跑时才执行；被 import 时只暴露 TRACKED_LINE。 */
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2)
  if (argv.includes('--help') || argv.includes('-h')) usageError('')
  let code
  try {
    code = await check(parseLine(argv))
  } catch (error) {
    console.error(`[WARN] ${error.message}`)
    code = 2
  }
  process.exit(code)
}
