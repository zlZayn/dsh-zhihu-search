/**
 * 编译器测试（防幻觉核心）。
 *
 * 每条断言对应一条**实测**的知乎语法，不是文档推断：
 * - \`VoteUpCount:desc\` / \`:asc\` / \`:(min,)\` 均在 2026-09-12 验证有效
 * - 未收录字段返回 10001 invalid SortBy field
 * - 站内搜索不接受 host 过滤；全网搜索拒绝知乎域名
 */

import { describe, expect, it } from 'vitest';
import { CompileError, compileFilter, compileSortBy, isZhihuDomain, toUnixSeconds } from '../src/utils/compiler.js';

describe('compileSortBy', () => {
  it('编译字段 + 默认降序 + 下限', () => {
    expect(compileSortBy({ sortField: 'voteUpCount', minValue: 50 })).toBe('VoteUpCount:desc:(50,)');
  });

  it('下限省略时不生成括号段', () => {
    expect(compileSortBy({ sortField: 'commentCount' })).toBe('CommentCount:desc');
  });

  it('支持升序', () => {
    expect(compileSortBy({ sortField: 'editTime', order: 'asc' })).toBe('EditTime:asc');
  });

  it('default 或缺省时不下发 SortBy', () => {
    expect(compileSortBy({ sortField: 'default' })).toBeUndefined();
    expect(compileSortBy({})).toBeUndefined();
  });

  it('sortField 缺省时，显式 order=desc 仍然放行（那是文档写明的默认值）', () => {
    expect(compileSortBy({ order: 'desc' })).toBeUndefined();
  });

  it('拒绝会被静默丢弃的 minValue，而不是当作没传', () => {
    expect(() => compileSortBy({ minValue: 100 })).toThrow(CompileError);
    expect(() => compileSortBy({ sortField: 'default', minValue: 100 })).toThrow(CompileError);
  });

  it('拒绝会被静默丢弃的非默认 order', () => {
    expect(() => compileSortBy({ order: 'asc' })).toThrow(CompileError);
  });

  it('拦截错误带可据以纠正的 hint', () => {
    try {
      compileSortBy({ minValue: 100 });
      expect.unreachable('应当抛出 CompileError');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      expect((error as CompileError).hint).toContain('sortField');
    }
  });

  it('下限截断为整数，避免生成知乎不认的小数语法', () => {
    expect(compileSortBy({ sortField: 'voteUpCount', minValue: 99.9 })).toBe('VoteUpCount:desc:(99,)');
  });

  it('对非法下限抛 CompileError 而不是静默产出坏字符串', () => {
    expect(() => compileSortBy({ sortField: 'voteUpCount', minValue: Number.NaN })).toThrow(CompileError);
  });

  it('拒绝负数下限 —— 知乎只收非负整数，本地拦下才给得出可据以纠正的 hint', () => {
    // 实测：服务端报 `SortBy bounds must be nonnegative integers`，
    // 而 10001 的通用 hint 讲的是 Filter/域名过滤，与模型的真实错误无关。
    try {
      compileSortBy({ sortField: 'voteUpCount', minValue: -5 });
      expect.unreachable('应当抛出 CompileError');
    } catch (error) {
      expect(error).toBeInstanceOf(CompileError);
      expect((error as CompileError).hint).toContain('非负');
    }
  });

  it('拒绝超出安全整数范围的下限，避免生成 1e+21 这类非法字面量', () => {
    expect(() => compileSortBy({ sortField: 'voteUpCount', minValue: 1e21 })).toThrow(CompileError);
  });
});

describe('compileFilter', () => {
  it('编译 host + publish_time，字符串加双引号、日期转秒级时间戳', () => {
    expect(compileFilter({ site: 'github.com', publishedAfter: '2023-01-01' })).toBe(
      'host=="github.com" AND publish_time>=1672531200',
    );
  });

  it('拒绝知乎域名 —— 全网搜索会直接返回错误', () => {
    expect(() => compileFilter({ site: 'zhihu.com' })).toThrow(CompileError);
    expect(() => compileFilter({ site: 'www.zhihu.com' })).toThrow(CompileError);
    expect(() => compileFilter({ site: 'zhuanlan.zhihu.com' })).toThrow(CompileError);
  });

  it('站内搜索作用域下拒绝 host 过滤（该端点只认 publish_time）', () => {
    expect(() => compileFilter({ site: 'github.com' }, 'zhihu')).toThrow(CompileError);
  });

  it('站内搜索作用域下允许 publish_time', () => {
    expect(compileFilter({ publishedAfter: '2024-01-01' }, 'zhihu')).toBe('publish_time>=1704067200');
  });

  it('剥掉开头的 www. —— host 是整串精确匹配，留着它会让查询静默返回 0 条', () => {
    expect(compileFilter({ site: 'www.github.com' })).toBe('host=="github.com"');
    expect(compileFilter({ site: 'https://www.github.com/a/b' })).toBe('host=="github.com"');
  });

  it('把整条 URL 归一化成主机名', () => {
    expect(compileFilter({ site: 'https://github.com/some/repo' })).toBe('host=="github.com"');
    expect(compileFilter({ site: 'GitHub.com' })).toBe('host=="github.com"');
  });

  it('无条件时返回 undefined（即不下发 Filter 参数）', () => {
    expect(compileFilter({})).toBeUndefined();
    expect(compileFilter({ site: '   ' })).toBeUndefined();
  });

  it('上下界同时存在时用 AND 连接', () => {
    expect(compileFilter({ site: 'x.com', publishedAfter: 100, publishedBefore: 200 })).toBe(
      'host=="x.com" AND publish_time>=100 AND publish_time<=200',
    );
  });
});

describe('toUnixSeconds', () => {
  it('纯日期按 UTC 解释，保证跨机器可复现', () => {
    expect(toUnixSeconds('2023-01-01')).toBe(1672531200);
  });

  it('无时区的日期时间也按 UTC 解释，而不是本机时区', () => {
    // 若按本机时区解释，这个断言会随运行机器的 TZ 变化而失败。
    expect(toUnixSeconds('2023-01-01T00:00:00')).toBe(1672531200);
  });

  it('接受已是秒级时间戳的数字与纯数字字符串', () => {
    expect(toUnixSeconds(1672531200)).toBe(1672531200);
    expect(toUnixSeconds('1672531200')).toBe(1672531200);
  });

  it('对无法解析的输入抛 CompileError', () => {
    expect(() => toUnixSeconds('不是日期')).toThrow(CompileError);
    expect(() => toUnixSeconds('')).toThrow(CompileError);
    expect(() => toUnixSeconds(-5)).toThrow(CompileError);
  });
});

describe('isZhihuDomain', () => {
  it('识别知乎主域与子域', () => {
    expect(isZhihuDomain('zhihu.com')).toBe(true);
    expect(isZhihuDomain('www.zhihu.com')).toBe(true);
    expect(isZhihuDomain('zhuanlan.zhihu.com')).toBe(true);
  });

  it('不误伤形似域名', () => {
    expect(isZhihuDomain('notzhihu.com')).toBe(false);
    expect(isZhihuDomain('zhihu.com.evil.com')).toBe(false);
  });
});
