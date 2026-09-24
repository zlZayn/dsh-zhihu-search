/**
 * 打包浏览器半体。
 *
 * 产物必须是 DSH 客户端模块系统的 lazy-CJS factory 形态：
 * 脚本执行时只**注册**工厂，模块体（含副作用）留到首次 require。
 *
 *     window.__ModuleLoader__.load({ id, factory: (require) => ({ ... }) })
 *
 * 官方在仓库内用 `packages/client/tsdown.client.ts` 的 `clientBundle()` 生成这个信封，
 * 但该预设未发布到 npm（官方 cookbook 明写「a package outside this repository has to
 * reproduce the same output format itself」），所以这里用 esbuild 复现：
 * 它的 cjs 输出正好以 `require(...)` 取外部模块、以 `module.exports` 收尾，
 * 信封提供这两者即可，无需自写 ESM→CJS 转换。
 */

import { existsSync, readFileSync } from 'node:fs';
import { build } from 'esbuild';

// 路径冲突守卫：tsc 把 src/<name>.ts 编译到 lib/<name>.js，rootDir 是 src、outDir 是 lib。
// 若存在 src/client.ts，它会与本脚本的 outfile 同名 —— 后跑的一方静默覆盖另一方。
// 这个冲突真实发生过：lib/client.js 被浏览器信封顶掉后，
// lib/utils/errors.js 的 `import ... from '../client.js'` 拿到的是信封，
// DSH 启动即 SyntaxError 崩溃。这里提前拦下，不再让两个产物抢同一个路径。
for (const stale of ['src/client.ts', 'src/client.tsx']) {
  if (existsSync(stale)) {
    throw new Error(
      `${stale} 与浏览器半体的输出路径 lib/client.js 冲突：请把它改名为 transport.ts 之类的名字。`,
    );
  }
}

/** bundle id 必须等于包名：模块表以它作 key。真源是 package.json 的 name。 */
const BUNDLE_ID = JSON.parse(readFileSync('package.json', 'utf8')).name;

/** 宿主基线模块与同侪包，一律不打包进去。 */
const HOST_PROVIDED = ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/client', '@deepseek-ai/*'];

await build({
  entryPoints: ['src/client/index.tsx'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  jsx: 'automatic',
  legalComments: 'none',
  external: HOST_PROVIDED,
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      `\tid: ${JSON.stringify(BUNDLE_ID)},`,
      '\tfactory: (require) => {',
      '\t\tvar module = { exports: {} };',
      '\t\tvar exports = module.exports;',
    ].join('\n'),
  },
  footer: { js: '\t\treturn module.exports;\n\t}\n});' },
});

console.log(`built lib/client.js as module ${BUNDLE_ID}`);
