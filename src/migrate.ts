/**
 * 一次性迁徙：把**组合配置**里手写的明文 Access Secret 搬进凭据域。
 *
 * 本模块有明确的删除条件 —— 等使用者都跨过这一版，连同 `Config.accessSecret`
 * 与那份 schema 注释一起整份删掉。它不该长期存在。
 *
 * ## 为什么只剩一条来源（2026-09-22，0.1.7-alpha.1 接缝迁移）
 *
 * 旧 `settings.yaml` 那一层随宿主一起没了，而且是**结构性**的：
 * 1. 宿主的 `importLegacyDocument()` 把旧文件改名为 `settings.yaml.imported`，然后
 *    **按 section 名当 entry id** 逐段导入，而它的 `LEGACY_SECTION_ENTRIES` 只映射三个
 *    官方 section（`ui-developer-tools` / `ui-onboarding` / `shell`）—— `zhihu-search`
 *    那一段永远导入不进去，只留在改名后的文件里。
 * 2. 就算导进去了，插件也读不到、更删不掉：0.1.7 的 `describe()` 只投影 **volatile**
 *    字段，而 `accessSecret` 必须是非 volatile（它是密钥，绝不能进表单）；`mutate` 对
 *    非 volatile 路径直接抛 `Config field "accessSecret" is not volatile`。
 *
 * 于是「先写后删」那半条纪律连同 `purge` 通道一起退场 —— 现在**没有任何东西可删**，
 * 「搬不动就原样保留」因此是结构性成立的，而不是靠调用顺序保证。
 *
 * ## 明文现在会出现在哪
 *
 * 活动 profile 的 Cordis patch，即有人手写 `config: { accessSecret: … }` 到
 * `dsh-zhihu-search` 那一行。那是**组合配置**，不属插件，插件没有也不该有改写它的口子，
 * 所以搬走之后只能告警请人手动删。
 *
 * ## 为什么只有 Host 搬得动
 *
 * redact 层在服务端就剥掉了 `role('secret')` 的值，卡片刻意永远收不到明文。
 * 这正是它安全的理由，也意味着迁徙只能发生在这一侧 ——
 * 「卡片上放个迁移按钮」做不到，按下去只能让用户重新粘贴一遍。
 *
 * 两条纪律：
 * 1. **凭据域已有值时不覆盖** —— 那是用户后来填的更新。
 * 2. **只吞预期失败**：搬不动就原样保留并告警，绝不阻断启动。
 *
 * 外部动作全部注入，因此本模块可脱离 Cordis、设置服务与文件系统单测。
 */

import { hasSecretValue } from './credentials.js';

/** 旧版明文可能来自的组合配置层；插件删不掉它。 */
export interface LegacySecret {
  /** 组合配置（`cordis.patch.yml` 的 `config.accessSecret`）里的明文。删不掉。 */
  readonly fromComposition?: string;
}

/** 迁徙所需的外部动作。 */
export interface MigrationDeps {
  /** 读组合配置里的旧明文。 */
  readonly readLegacy: () => LegacySecret;
  /** 凭据域里该引用名是否已有值（含环境变量这类只读层）。 */
  readonly hasCredential: () => Promise<boolean>;
  /** 把值写进凭据域。 */
  readonly adopt: (value: string) => Promise<void>;
  /** 该用哪个引用名，用于让诊断可操作。 */
  readonly referenceName: () => string;
  /** 一条告警通道。 */
  readonly warn: (message: string) => void;
}

/**
 * 取一条可读的失败描述。
 *
 * 远程失败是 `Error` 实例，但注入的替身与设置层可能抛别的东西，
 * 诊断本身不该成为故障源。
 *
 * @param error - 捕获到的值。
 * @returns 一行描述。
 */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 把组合配置里的旧明文收进凭据域，并告警请人手动删掉那一行。
 *
 * @param deps - 全部外部动作。
 */
export async function migrateLegacySecret(deps: MigrationDeps): Promise<void> {
  const { fromComposition } = deps.readLegacy();
  const composition = hasSecretValue(fromComposition) ? fromComposition : undefined;
  // 绝大多数启动走这条：没有旧明文，一个外部动作都不做。
  if (composition === undefined) return;

  try {
    if (await deps.hasCredential()) {
      deps.warn(
        `[zhihu-search] 凭据存储里已有 ${deps.referenceName()}，保留它；cordis.patch.yml 里那份明文是残留，请手动移除该行。`,
      );
      return;
    }
    await deps.adopt(composition);
  } catch (error) {
    // 写不进去时明文原样留在组合配置里 —— 这里没有任何删除动作，所以不存在「搬一半丢密钥」。
    deps.warn(`[zhihu-search] 旧明文迁入凭据存储失败，已原样保留：${describe(error)}`);
    return;
  }

  deps.warn(
    `[zhihu-search] 已把 cordis.patch.yml 的 config.accessSecret 迁入凭据存储（引用名 ${deps.referenceName()}）。它是组合配置，插件删不掉，请手动移除该行。`,
  );
}
