# 决策：直答流的判错与生命周期按官方错误形态修正（2026-09-14）

已实施。

## 问题

实调三个工具时暴露三处，全部集中在直答这条流式路径上；前两处会**把失败说成成功**：

1. **中途失败帧没有被识别**。官方文档定义：HTTP 200 发出后若出错，服务端发一帧
   `finish_reason: "error"` 加顶层 `error` 体，随后是 `[DONE]`。`deltaFromPayload` 只读
   `delta.content` / `delta.reasoning_content`，这种帧在它眼里就是「空增量」被丢掉，
   `chat()` 照常拼完已收到的片段返回 —— **半截回答被当成完整答案交付**。
2. **直答的错误码是字符串，被当成数字读**。`#chatErrorFrom` 写的是
   `typeof failure.code === 'number'`，而官方形态是 `code: "model_not_found"`（另有 `type`）。
   实测撞到过一次：直答回 `rate limit exceeded`，插件给出 `kind=unknown`、无 hint，
   模型无从判断该等待、该换档位，还是该改 Secret。
3. **响应头之后定时器与 signal 转发都被释放**。`openChatStream` 在拿到响应头后立刻
   `timed.dispose()`，而 dispose 同时清定时器**并摘掉调用方 signal 的 abort 监听**。
   于是流式读取既没有本地超时，也不再响应取消（`src/README.md` 当时把它写成「靠调用方
   signal 终止」，与代码不符）。

顺带修掉一处同源缺陷：超时用裸 `Error('zhihu request timeout')` 作 abort 原因，
被映射成 `network`（提示去查 TLS/代理）。`ZhihuErrorKind` 里的 `'timeout'` 因此从未被产出过。

## 决策

- `deltaFromPayload` 额外解析 `finish_reason` 与顶层 `error`，产出 `error` 字段；
  `chat()` 见到即终止整轮。判错复用新增的 `classifyChatFailure(failure, status)`：
  按 `type`/`code` 字符串与 HTTP 状态分类，各自带可行动 hint。
- 流式读取的生命周期交给一个包装流：定时器与 signal 转发**活到流结束**（正常关闭、
  出错、被取消三条路径都释放）。超时用带分类的 `ZhihuClientError` 作 abort 原因。
- **流式生成有自己的读取预算**：Config 的 `streamTimeoutMs`（默认 `DEFAULT_STREAM_TIMEOUT_MS`，55s），
  客户端取它与 `timeoutMs` 的**较大者**，直答工具的超时再由它加余量推导 —— 三者联动，不再各自写死。
  没有这一条，第 3 项修好之后反而会拿搜索级的 15s 去切正常进行的长回答；
  工具预算晚于传输层超时，失败才能以结构化错误交回模型。

## 替代方案

- **中途失败帧只记日志、照常返回片段**：保留了「有总比没有好」，代价是把不完整当完整 ——
  模型会引用一段被截断的结论，且没有任何信号。
- **把部分答案与错误一起回传**（新增 `partial: true`）：Canonical Output 变更，
  且模型需要新规则才能正确使用；在「错误必须能被模型区分」的契约下，先按失败处理。
- **只按 `message` 正则分类**：中文/英文措辞会变，`type`/`code` 才是稳定字段；
  正则仅作为兜底证据。
- **不设流式预算，直接把 `timeoutMs` 调大**：会让搜索也跟着变慢失败，
  且把「生成比检索慢」这个事实藏进用户配置。

## 影响

- 直答的失败面从 `unknown` 收敛到 `rate_limit` / `auth` / `param` / `server`，
  与搜索侧的 `kind` 取值域一致；模型可据 hint 换档位或稍后重试。
- 新增回归：中途失败帧（解析层 + 工具层）、字符串错误码分类、响应头之后的取消与超时、
  仍在推进的流不被搜索超时切断。全部落在 [test/sse.test.ts](../../test/sse.test.ts) 与
  [test/tool.test.ts](../../test/tool.test.ts)。
- 档位：旧用法没有「正确地依赖半截答案」这回事 → Q1 否；观感上只是失败得更准确 →
  Q3 否 → **patch**。

## 关联

- [架构说明](../../docs/ARCHITECTURE.md) 的「错误契约」「防错清单」「与知乎官方文档的偏差」
- [源码手册](../../src/README.md) 的「已知限制」
