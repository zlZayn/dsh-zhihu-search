/**
 * Access Secret 的解析：三条来源、固定优先级、可单测。
 *
 * 为什么独立成模块：优先级是**契约**而不是实现细节 ——
 * 设置界面填的值、凭据记录、环境变量三者谁赢，直接决定用户改了设置为什么不生效。
 * 写在 `apply()` 的闭包里就没法单测，而这类问题只在真机上暴露。
 */

/** 解析所需的三条来源。全部是函数，因为密钥可以在运行期被改动。 */
export interface SecretSources {
  /** 凭据域查询。返回空白串按「未配置」处理。 */
  readonly fromCredentials: (reference: string) => Promise<string | undefined>;
  /** 设置 section 里由用户直接填写的值。 */
  readonly fromSettings: () => string | undefined;
  /** 环境变量查询。 */
  readonly fromEnvironment: (name: string) => string | undefined;
  /** 凭据引用名（默认 `ZHIHU_ACCESS_SECRET`）。 */
  readonly referenceName: () => string;
}

/** 判定一个候选值是否可用：必须是含非空白字符的字符串。 */
function usable(value: string | undefined): value is string {
  return value !== undefined && value.trim() !== '';
}

/**
 * 按固定优先级解析 Access Secret。
 *
 * 优先级：**凭据域 → 设置 section → 环境变量**。
 * 凭据域排在第一位，是因为它是设置界面与凭据记录的落点；
 * 排在它前面的任何来源都会让「我在设置里填了却不生效」变成一个真实故障。
 *
 * @param sources - 三条来源。
 * @returns 可用的密钥；三条都空时返回 `undefined`，由调用方转成鉴权错误。
 */
export async function resolveAccessSecret(sources: SecretSources): Promise<string | undefined> {
  const reference = sources.referenceName();

  const fromCredentials = await sources.fromCredentials(reference);
  if (usable(fromCredentials)) return fromCredentials;

  const fromSettings = sources.fromSettings();
  if (usable(fromSettings)) return fromSettings;

  const fromEnvironment = sources.fromEnvironment(reference);
  if (usable(fromEnvironment)) return fromEnvironment;

  return undefined;
}
