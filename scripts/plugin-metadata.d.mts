/**
 * [plugin-metadata.mjs](plugin-metadata.mjs) 的类型面。
 *
 * 为什么手写而不是靠 `allowJs`：`tsconfig.test.json` 要能 `import` 这个判定模块
 * （守卫与测试读**同一份**判定，不许各写一套），而打开 `allowJs` 会把本目录另外几个
 * `.mjs` 一起拖进 `strict` 的检查面 —— 那是另一件事，不该搭这趟车。
 *
 * **改实现时同批改这里。** 漂了不会静默：`npm run typecheck` 与
 * [../test/plugin-metadata.test.ts](../test/plugin-metadata.test.ts) 都会红。
 */

/** 一份清单的松散形状：调用方（测试）要就地改它做反向控制。 */
export interface Manifest {
  name: string;
  description?: string;
  icon?: string;
  files: string[];
  exports: Record<string, unknown>;
  [key: string]: unknown;
}

/** 逐条判定结果与读到的元数据。 */
export interface MetadataReport {
  /** `locale/` 下的语言 id（文件名去掉 `.json`），已排序。 */
  languageIds: string[];
  /** 每个语言的 `meta.title`；缺失或空白时 `undefined`。 */
  titles: Record<string, string | undefined>;
  /** 每个语言的 `meta.description`；缺失或空白时 `undefined`。 */
  descriptions: Record<string, string | undefined>;
  /** 没通过的条件，每条的形态是「判定名 —— 该怎么改」。 */
  failures: string[];
}

/**
 * 读仓库根的展示元数据并逐条判定随包不变量。
 *
 * @param root - 仓库根目录。
 * @param pkg - 已经解析好的 `package.json`；不传就地读。
 * @returns 逐条判定结果与读到的元数据。
 */
export function inspectPluginMetadata(root: string, pkg?: Manifest): MetadataReport;

/**
 * 就地读仓库根的 `package.json`。
 *
 * @param root - 仓库根目录。
 * @returns 解析后的清单。
 */
export function readManifest(root: string): Manifest;

/**
 * 读 `locale/<language>.json` 里的 `meta`。
 *
 * @param root - 仓库根目录。
 * @param language - 语言 id，例如 `en`。
 * @returns `meta` 字段，缺文件时 `undefined`。
 */
export function displayMetadata(root: string, language: string): { title?: string; description?: string } | undefined;
