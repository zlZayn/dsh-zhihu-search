/**
 * Access Secret 的解析：一条链、两条来源、可单测。
 *
 * 凭据域是**唯一**的取值口。provider 自己已按
 * 进程环境 > `.credentials.yaml` > 项目 `.env` > `$DSH_HOME/.env` 分层，
 * 所以插件这一层只需要「问凭据域，问不到再问进程环境」——
 * 后者只在 provider 根本没挂载时才有意义。
 *
 * 设置里**没有**字面量通道：旧版写下的明文由 [migrate.ts](./migrate.ts) 一次性搬走。
 * 曾经的三源优先级（凭据域 → 设置字面量 → 环境变量）随之作废 ——
 * 三个来源才需要定序，一个取值口不需要。
 *
 * 为什么独立成模块：这是「密钥从哪来」的唯一决策点，
 * 而它的错法（填了却不生效）只在真机上暴露。写在 `apply()` 的闭包里就没法单测。
 */

/** 解析所需的两条来源。都是函数，因为密钥与引用名都可以在运行期被改动。 */
export interface SecretSources {
  /** 凭据域查询。返回空白串按「未配置」处理。 */
  readonly fromCredentials: (reference: string) => Promise<string | undefined>;
  /** 进程环境查询，仅在凭据域缺席时生效。 */
  readonly fromEnvironment: (name: string) => string | undefined;
  /** 凭据引用名（默认 `ZHIHU_ACCESS_SECRET`）。 */
  readonly referenceName: () => string;
}

/**
 * 判定一个候选值是不是「配好了的密钥」。
 *
 * 空白串与纯空白一律算未配置 —— 这条规则由 seam 保证（存储里的空值在所有读路径上缺席），
 * 插件这一层再判一次，是为了兜住环境变量与注入替身。空串伪装成已配置，
 * 换来的是一个空 `Bearer` 和上游一句难懂的 `20001`。
 *
 * @param value - 候选值。
 * @returns 是否可用。
 */
export function hasSecretValue(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * 按固定顺序解析 Access Secret。
 *
 * 顺序：**凭据域 → 进程环境**。
 *
 * @param sources - 两条来源。
 * @returns 可用的密钥；两条都空时返回 `undefined`，由调用方转成鉴权错误。
 */
export async function resolveAccessSecret(sources: SecretSources): Promise<string | undefined> {
  const reference = sources.referenceName();

  const stored = await sources.fromCredentials(reference);
  if (hasSecretValue(stored)) return stored;

  const ambient = sources.fromEnvironment(reference);
  return hasSecretValue(ambient) ? ambient : undefined;
}
