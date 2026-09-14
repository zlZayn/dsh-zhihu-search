/**
 * 契约（真实上游）：`zhihu_global_search` 全网搜索的行为指纹。
 *
 * 与站内那份的分工见 [contract-live-search.test.ts](contract-live-search.test.ts)。
 * 两条最值钱的指纹：**host 是整串精确匹配**（根域不命中子域）与 **SortBy 被忽略**
 * —— 插件的参数面正是照这两条裁出来的。
 */

import { describe, expect, it } from 'vitest';
import {
  callApi,
  editTimesOf,
  fingerprintLine,
  hasCredential,
  hostsOf,
  idsOf,
  isSubdomainOf,
  sameSequence,
  strField,
  votesOf,
} from './contract-helpers.js';

const GLOBAL = '/api/v1/content/global_search';
const QUERY = 'DeepSeek';
const DAY_SECONDS = 86_400;

describe.skipIf(!hasCredential)('契约：zhihu_global_search 全网搜索', () => {
  it('Count 上限仍是 20：传 50 也只回 20 条', async () => {
    const r = await callApi(GLOBAL, { Query: QUERY, Count: 50 });
    console.log(fingerprintLine('全网基线', r));
    expect(r.code).toBe(0);
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items.length, '上限变了就要同步 tools/global-search.ts 的 MAX_COUNT 与 README 的 1–20').toBeLessThanOrEqual(20);
  });

  it('host 是整串精确匹配：返回的 host 恒等于过滤值，根域不命中子域', async () => {
    const sub = await callApi(GLOBAL, { Query: QUERY, Count: 10, Filter: 'host=="news.qq.com"' });
    expect(sub.code).toBe(0);
    expect(sub.items.length).toBeGreaterThan(0);
    for (const host of hostsOf(sub.items)) expect(host).toBe('news.qq.com');

    const root = await callApi(GLOBAL, { Query: QUERY, Count: 10, Filter: 'host=="qq.com"' });
    expect(root.code).toBe(0);
    for (const host of hostsOf(root.items)) {
      expect(
        isSubdomainOf(host, 'qq.com'),
        '若失败：上游把 host 改成了后缀匹配 —— 插件的「子站要单独写」说明与 www 归一化都要重评',
      ).toBe(false);
    }
  });

  it('host!= 仍可用（排除站点）', async () => {
    const r = await callApi(GLOBAL, { Query: QUERY, Count: 10, Filter: 'host!="github.com"' });
    expect(r.code).toBe(0);
    for (const host of hostsOf(r.items)) expect(host).not.toBe('github.com');
  });

  it('知乎域名仍被拒绝（插件的本地预检照抄了这条）', async () => {
    const r = await callApi(GLOBAL, { Query: QUERY, Count: 5, Filter: 'host=="zhihu.com"' });
    expect(r.code).toBe(10001);
  });

  it('SortBy 仍被忽略：换排序字段不改变结果顺序', async () => {
    const baseline = await callApi(GLOBAL, { Query: QUERY, Count: 10 });
    const sorted = await callApi(GLOBAL, { Query: QUERY, Count: 10, SortBy: 'VoteUpCount:desc' });
    expect(
      sameSequence(idsOf(sorted.items), idsOf(baseline.items)),
      '若失败：上游开始支持排序了 —— 那是新能力，值得给 zhihu_global_search 补上 sortField',
    ).toBe(true);
  });

  it('Filter=publish_time 生效：返回项的 EditTime 全部不早于阈值', async () => {
    const since = Math.floor(Date.now() / 1000) - 30 * DAY_SECONDS;
    const r = await callApi(GLOBAL, { Query: QUERY, Count: 10, Filter: `publish_time>=${String(since)}` });
    expect(r.code).toBe(0);
    const times = editTimesOf(r.items);
    expect(times.length).toBeGreaterThan(0);
    for (const time of times) expect(time).toBeGreaterThanOrEqual(since);
  });

  it('外站页面仍是「空 ContentType + 占位 0 赞」（渲染层据此不展示点赞）', async () => {
    const r = await callApi(GLOBAL, { Query: QUERY, Count: 10, Filter: 'host=="github.com"' });
    expect(r.code).toBe(0);
    expect(r.items.length).toBeGreaterThan(0);
    for (const item of r.items) {
      expect(strField(item, 'ContentType'), '若失败：外站页面开始带类型，渲染层的空串判据要重评').toBe('');
      expect(votesOf([item])[0], '若失败：外站开始给真实点赞数，占位 0 的取舍要重评').toBe(0);
    }
  });
});
