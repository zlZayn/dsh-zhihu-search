/**
 * 一次性迁徙：把旧版写在设置里的明文 Access Secret 搬进凭据域。
 *
 * 本模块有明确的删除条件 —— 等使用者都跨过这一版，连同 `Config.accessSecret`
 * 与卡片上那条只读提示一起整份删掉。它不该长期存在。
 *
 * 为什么只有 Host 搬得动：redact 层在服务端就剥掉了 `role('secret')` 的值，
 * 卡片刻意永远收不到明文。这正是它安全的理由，也意味着迁徙只能发生在这一侧 ——
 * 「卡片上放个迁移按钮」做不到，按下去只能让用户重新粘贴一遍。
 *
 * 三条纪律，顺序不可换：
 * 1. **先写凭据域，再删设置里的明文**。反过来中途失败 = 密钥永久丢失。
 * 2. **凭据域已有值时不覆盖**，只清残留 —— 那是用户后来填的更新。
 * 3. **只吞预期失败**：搬不动就原样保留并告警，绝不阻断启动。
 *
 * 外部动作全部注入，因此本模块可脱离 Cordis、设置服务与文件系统单测。
 */

import { hasSecretValue } from './credentials.js';

/** 旧版明文可能来自两个层；只有设置文档那一层能被程序删掉。 */
export interface LegacySecret {
  /** 设置文档 user 层里的明文。删得掉。 */
  readonly fromSettings?: string;
  /** 组合配置（`cordis.patch.yml` 的 `config.accessSecret`）里的明文。删不掉。 */
  readonly fromComposition?: string;
}

/** 迁徙所需的外部动作。 */
export interface MigrationDeps {
  /** 读两个层里的旧明文。 */
  readonly readLegacy: () => LegacySecret;
  /** 凭据域里该引用名是否已有值（含环境变量这类只读层）。 */
  readonly hasCredential: () => Promise<boolean>;
  /** 把值写进凭据域。 */
  readonly adopt: (value: string) => Promise<void>;
  /** 从设置文档里抹掉 `accessSecret`；同段其余字段必须存活。 */
  readonly purge: () => Promise<void>;
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
 * 把旧版明文收进凭据域，并从能删的那一层抹掉。
 *
 * @param deps - 全部外部动作。
 */
export async function migrateLegacySecret(deps: MigrationDeps): Promise<void> {
  const { fromSettings, fromComposition } = deps.readLegacy();
  const settings = hasSecretValue(fromSettings) ? fromSettings : undefined;
  const composition = hasSecretValue(fromComposition) ? fromComposition : undefined;
  // 绝大多数启动走这条：没有旧明文，什么都不做。
  if (settings === undefined && composition === undefined) return;

  // ── 第一步：先写。写不进去就一点都别删，否则密钥会永久丢失。 ──
  let adopted = false;
  try {
    if (await deps.hasCredential()) {
      deps.warn(`[zhihu-search] 凭据存储里已有 ${deps.referenceName()}，保留它；旧的明文按残留清除。`);
    } else {
      await deps.adopt(settings ?? composition!);
      adopted = true;
    }
  } catch (error) {
    deps.warn(`[zhihu-search] 旧明文迁入凭据存储失败，已原样保留：${describe(error)}`);
    return;
  }

  // ── 第二步：后删。只删得动设置文档那一层。 ──
  // 这一步不依赖上一步是否真的写过值：上次搬到一半留下的残留，这次会被清掉。
  if (settings !== undefined) {
    try {
      await deps.purge();
      deps.warn(
        adopted
          ? `[zhihu-search] 已把 settings.yaml 里的明文 Access Secret 迁入凭据存储（引用名 ${deps.referenceName()}）并删除原文。`
          : '[zhihu-search] 已删除 settings.yaml 里被凭据存储遮蔽的明文 Access Secret。',
      );
    } catch (error) {
      deps.warn(
        `[zhihu-search] 密钥已可用，但 settings.yaml 里的明文删除失败，请手动删掉 zhihu-search.accessSecret：${describe(error)}`,
      );
    }
  }
  if (composition !== undefined) {
    deps.warn(
      '[zhihu-search] cordis.patch.yml 的 config.accessSecret 是组合配置，插件删不掉，请手动移除该行。',
    );
  }
}
