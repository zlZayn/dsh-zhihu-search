/**
 * redact 锚点契约（**0.1.7 起理由换了一半，机制没变**）。
 *
 * 实测结论仍然成立：`redactSecrets` 是 **schema 驱动** 的 —— 字段一旦移出 schema，
 * 它就不再被认作密钥。但 0.1.7 的配置页只投影 **volatile** 字段
 * （settings 包的 `volatileForm` + `projectForm`），而非 volatile 的 `accessSecret`
 * 结构上不可能出现在发往浏览器的 value / base / user 里 ——
 * **那条线路上已经没有保护对象了**，所以它不再是「字段必须留下」的理由。
 *
 * 字段今天留下来的理由只有一个：它是**组合配置单向迁徙**的读取入口
 * （见 [src/migrate.ts](../src/migrate.ts)）。相应地，这条测试守的是
 * 「这个槽位仍然带 `role('secret')`、redact 仍然认得它」——
 * 谁把角色摘掉、或把字段删掉，它会立刻变红。
 * 背景见 [docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) 的「密钥解析契约」。
 */

import { describe, expect, it } from 'vitest';
import { redactSecrets } from '@deepseek-ai/dsh-settings';
import { Config } from '../src/index.js';

/** 明文值；断言它不出现在任何下行内容里。 */
const PLAINTEXT = 'PLAINTEXT-MUST-NOT-TRAVEL';

/**
 * 按 DSH 的调用约定调 `redactSecrets`。
 *
 * 它的形参声明成 `z<never>` —— DSH 内部是把 schema 擦除成这个类型之后才传进去的，
 * 而运行时接受任何 schemastery schema。这里照同一约定擦除，好过在断言里撒 cast。
 *
 * @param value - 待脱敏的设置段值。
 * @returns 剥掉密钥字段的值，以及各密钥槽位的「有没有值」。
 */
function redact(value: unknown): ReturnType<typeof redactSecrets> {
  return redactSecrets(Config as never, value);
}

describe('Config.accessSecret 仍带 secret 角色（redact 认得这个槽位）', () => {
  it('两个字段各自带 secret 与 credential-ref 角色', () => {
    const dict = (Config as unknown as { dict: Record<string, { meta?: { role?: string } }> }).dict;
    expect(dict['accessSecret']?.meta?.role).toBe('secret');
    expect(dict['accessSecretRef']?.meta?.role).toBe('credential-ref');
  });

  it('redactSecrets 剥掉明文，只留下「这个槽位有值」这一个事实', () => {
    const { value, secrets } = redact({
      accessSecret: PLAINTEXT,
      accessSecretRef: 'ZHIHU_ACCESS_SECRET',
    });

    expect(value).not.toHaveProperty('accessSecret');
    expect(JSON.stringify(value)).not.toContain(PLAINTEXT);
    expect(secrets).toContainEqual({ path: ['accessSecret'], set: true });
  });

  it('槽位没值时报 set: false，而不是干脆不报', () => {
    const { secrets } = redact({});
    expect(secrets).toContainEqual({ path: ['accessSecret'], set: false });
  });
});
