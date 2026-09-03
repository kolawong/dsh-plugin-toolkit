# 立项方案：编辑上一条消息并「原位重发」

> 状态：设计已收敛，M1/M3 服务端实现中。第二个 toolkit 优化 `editLastMessage`，
> 重发语义为**原位替换**：编辑上一条用户消息后，该消息之后的旧内容从会话中真正收回，
> 模型下一条回复看到的上下文是「改后的话 + 全新回合」。

## 1. 背景与诉求

用户痛点：模型出问题想重试时，只能复制上一句重发，无法直接编辑上一句再重发；
来回重试不清楚上下文会不会被污染。

期望：上一条用户消息上有「编辑」按钮 → 点击后编辑内容 → 重发，
会话记录中**删除从该消息往后的旧内容**，以新内容开启下一回合（ChatGPT 式原位编辑）。

已确认取舍：**原位替换**（而非追加式重发）。这要求改动 dsh host，
按本 package 的毕业规则本就应单独立项 —— 本方案即立项文档。

## 2. 现状（已核实的事实，代码锚点）

- 会话模型是 **append-only 事件流**：`packages/core/session/src/index.ts`
  `Session.events` + `session.append(type, data, {surfaceOp})`；持久化由
  `session-persistence-{jsonl,sqlite}` 异步缓冲，事件即存即用、无 schema。
- **surface 子系统已经是"回滚"机制**（`core/session/src/surface.ts`，注释明言
  "any surface-replacing producer may use it"）：`user/message` / `assistant/message`
  / `tool/result` 携带 `surfaceOp: 'append' | {op:'replace',start,end}`；
  一条 replace 事件把 [start..end] 的旧 surface 节点从**模型可见派生历史**
  （`Session.deriveMessages()` → LLM 请求 messages，`core/agent-loop/src/agent.ts:353`）
  中整体替换掉。compaction 就用它落盘（`compaction-basic/src/region.ts:472`：
  `session.append('user/message', checkpoint, { surfaceOp:{op:'replace',start,end}, sourceEventSeqs:[…, ...shadowedSeqs] })`）。
  replace 的 provenance 校验强制 `sourceEventSeqs` 覆盖全部被替换节点。
- 输入交付：`prompt` RPC（`api/session-controller/src/commands.ts:283`）→
  `resolveAgent` + `createUserMessage` + `agent.followup(message)`（inbox 投递，
  落 `agent/inbox/spliced`）→ loop 在回合内 claim 后 `session.append('user/message', message, {surfaceOp:'append'})`
  （`agent.ts:289-291`）。
- 事件词汇表是**生成的**（`known-event-types.ts` ← `scripts/gen-persistence-catalog.ts`）。
- 客户端转录（`ui-conversation` records.ts / assembler）按事件序**全量呈现**
  （compaction 也是"旧内容留在上面 + 标记节点"），所以"擦除"需要客户端识别改写标记。
- 客户端会话窗口支持 journal `replace | prepend | append`（整窗重建 `installWindow`）。

## 3. 设计（收敛后）：不加新事件类型，纯 surface + 来源标记

**不改写物理日志、不加新事件类型、不改持久化、不改 catalog。** 改写 = 追加一条
带 replace surfaceOp 的 `user/message`，`source` 上带 `origin: 'edit'` 标记：

### 3.1 新 RPC `session.rewrite`（api/session-controller）

请求：`{ sessionId, messageSeq, content }`（content 为 text 块，v1 不支持图片）。

校验（沿用 prompt 的 reject 风格）：
- 会话/Agent 存在且**空闲**（running 中拒绝，避免竞态）；
- `messageSeq` 必须指向会话日志中**最后一条** `user/message` 且 `data.source.kind === 'user'`
  （直接人类消息；被 compaction 替换掉的旧消息不在 surface 上 → 拒绝）；
- 新内容非空、纯文本。

执行（RPC 只校验 + 投递，落盘交给 loop，见 3.2）：
1. `message = createUserMessage({ content, source: { kind:'user', rpcId:<new>, origin:'edit', rewriteSeq: messageSeq } })`。
2. `agent.followup(message)` —— 投递进 inbox，唤醒 loop 开下一回合。

### 3.2 agent loop：改写消息以 surface replace 落盘 + 去重

`agent-loop/src/agent.ts`（回合 step 的 message 追加点）：对 `origin === 'edit'` 的消息，
用 `session.surface.nodes` 计算 `shadowed = surface 中 [rewriteSeq..尾] 的节点`，以
`session.append('user/message', message, { surfaceOp:{op:'replace',start:rewriteSeq,end}, sourceEventSeqs: shadowed })`
落盘——**模型上下文在此步原生回滚**，`deriveMessages()` 立即只含编辑后的消息。
已入日志的同 id 消息（重启重放）跳过追加。`buildRequest`/`step` 不变（请求消息本来就取自 `deriveMessages()`）。

### 3.3 客户端转录：识别改写并擦除区间

`ui-conversation` 组装器：遇到 `user/message` 且 `data.source.origin === 'edit'` 时——

- 渲染为**普通用户气泡**（替换旧气泡）；
- **丢弃** seq 在 `(surfaceOp.start, 该事件 seq)` 之间的所有事件（旧消息 + 失败回合的
  turn 边界/retry/chunk 等），从可见转录中擦除。

compaction 的"旧内容留在上面"语义不受影响（其标记不带 origin:'edit'）。

### 3.4 回合与 seq 语义

- 日志保持 append-only、seq 单调；物理上旧事件仍在，surface 与转录两视图都视为被取代。
- 下一回合号 = 失败回合号 + 1（turn/start 仍物理存在于日志，loop 的
  `findLast turn/start` 继续 +1）；转录擦除不改变编号（v1 接受，无感知差异）。
- 重启恢复：surface 重放 replace → `deriveMessages()` 重建为编辑后历史；
  inbox 重放投递 → loop 按 id 去重，不重复追加。**恢复一致**。

## 4. 插件侧（沿用 toolkit 现有模式）

与 host 解耦，RPC 存在时启用（能力探测）：

- 客户端注册 `conversation.chat.node` 槽位 `user` key 的渲染器（priority -1 盖过内置 0，
  槽位语义：同 key 不同 priority 叠加、最低胜出），在**最后一条用户消息**的 action 行加
  **铅笔编辑**按钮；气泡/操作行用本插件自带 chrome（inline 样式 + 共享 CSS 变量 +
  ui-primitives 的 `projectUserText`/`JsonBlock`/`Tooltip`/图标/剪贴板），**不跨包 import**（符合
  客户端 bundle 纯净度门：跨插件 value import 禁止）。
- 点编辑 → 气泡**原位变成可编辑文本框**（不再弹窗，气泡同款 chrome；Esc 取消、Ctrl+Enter /
  「重新生成」提交）→ 调用 `session.rewrite`（改写即发送）。运行中会话会以
  `agent-busy` 内联报错，回合空闲后重试即可。
- 设置卡片：`optimizations.editLastMessage`（默认开）+ 子卡片 + zh/en locale +
  语义说明文案；host 不支持 rewrite 时按钮点击提示"不支持"。

## 5. 里程碑

| # | 内容 | 关键文件 | 状态 |
|---|---|---|---|
| M0 | 立项文档 + 设计收敛 | `docs/initiative-edit-resend.md` | ✅ |
| M1 | RPC `session.rewrite`（校验 + 投递） | `api/session-controller` | ✅ |
| M3 | agent loop replace 落盘 + 同 id 去重 | `core/agent-loop/src/agent.ts` | ✅ |
| M2 | 恢复一致性验证（surface 重放 + inbox 去重） | 单测 | ✅ |
| M4 | 客户端转录擦除 + ui-chat 渲染 | `client/ui-conversation`、`client/ui-chat` | ✅ |
| M5 | 插件按钮 + 设置卡片 + locale + README（含中文） | `dsh-plugin-toolkit` | ✅ |
| M6 | 单测（7 例）+ 重建 bundle + 重启 + 线上 e2e | scripts | ✅ |
| M7 | 规范整改（去掉 ui-chat 深度 import，气泡自渲染） | `client.js`、`package.json` | ✅ |

## 6. 风险与缓释

- **surface 尾部不连续**：旧消息之后若存在其它回合的 surface 节点（如失败后又发过消息），
  v1 的"最后一条用户消息"约束使其不可能；RPC 校验兜底。
- **重复追加**：同 id 去重；id 为随机 UUID，与普通投递无碰撞。
- **客户端窗口截断**：改写区间跨出已加载窗口时按 seq 范围擦除依然成立（区间内事件被丢弃，
  区间外不受影响）。
- **改造面在运行的 harness 上**：改完需重建 + 重启 `deepseek-harness.service`，
  执行节奏已与用户确认（立即开始）。