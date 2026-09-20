# 立项方案：编辑上一条消息并「原位重发」

> 状态：设计已收敛，M1–M7 已完成并在线上验证。第二个 toolkit 优化 `editLastMessage`，
> 重发语义为**原位替换**：编辑上一条用户消息后，该消息之后的旧内容从会话中真正收回，
> 模型下一条回复看到的上下文是「改后的话 + 全新回合」。
>
> ⚠️ host 侧改动不在本插件内，**每次 dsh 升级后必须重放**：
> `node scripts/apply-host-patch.mjs`（补丁在 `host/session-rewrite.patch`）。
> 2026-09-17 曾因升级丢失过一次，原因与恢复见文末第 7 节。

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
| M8 | 升级丢失恢复 + 补丁持久化（`host/session-rewrite.patch`、`scripts/apply-host-patch.mjs`、`scripts/e2e-verify-rewrite.mjs`） | 本仓库 + dsh checkout | ✅ |
| M9 | 投影改写一致性：`turnOutline`/`titleInput` 识别 `origin:'edit'` 的 replace、fallback 标题重算、provider 输入过滤 | `session-turn-outline`、`session-title`（补丁扩到 20 文件） | ✅ |

## 6. 风险与缓释

- **surface 尾部不连续**：旧消息之后若存在其它回合的 surface 节点（如失败后又发过消息），
  v1 的"最后一条用户消息"约束使其不可能；RPC 校验兜底。
- **重复追加**：同 id 去重；id 为随机 UUID，与普通投递无碰撞。
- **客户端窗口截断**：改写区间跨出已加载窗口时按 seq 范围擦除依然成立（区间内事件被丢弃，
  区间外不受影响）。
- **改造面在运行的 harness 上**：改完需重建 + 重启 `deepseek-harness.service`，
  执行节奏已与用户确认（立即开始）。

## 7. 升级丢失与重放（2026-09-17）

**症状**：编辑上一条用户消息后点「发送」，内联红字报「当前 host 不支持改写」。

**根因**：host 侧 12 个文件的改动（M1/M3/M4）一直只是 `/root/deepseek-harness`
工作区的未提交修改。2026-08-31 的 `dsh-upgrade` 把它 auto-stash 成
`stash@{1}`（同日的 `f310404d96` 是同一实现的 WIP 提交），此后 master 被 reset /
`pull --ff-only` 到上游；反复重建最终在 2026-09-15 22:28 用干净 master 的产物覆盖了
旧 lib，2026-09-16 16:56 的 `systemctl restart` 让运行中的进程换成了没有
`session.rewrite` 的版本。客户端的 `session.rewrite` 是同一补丁的 M4 部分，所以
新旧不匹配时表现为「有铅笔、点发送报 404 / 不支持」。与 approval policy 改动无关。

**恢复来源**：`stash@{1}`（"dsh-upgrade auto-stash 2026-08-31 10:08:32"）与
悬空提交 `f310404d96`。

**本次重放目标**：harness master `0d1f50007f`（2026-09-15）。

**重放时的必要适配**（上游两周漂移）：

- `SurfaceOp.replace` 字段改名：`{op:'replace', start, end}` → `{op:'replace', startSeq, endSeq}`（`agent.ts`、`assembly.ts`）。
- `session.events` → `session.snapshotEvents()`（`agent.ts`、`commands.ts`）。
- 客户端 REST 结果类型 `ClientResult`/`toSessionResult`/`transportResult` → `RemoteResult`（`session-controller` client）。
- `createUserMessage` 的 content 需要可变 `ContentBlock[]`。
- 错误码走当前 `RemoteError` 词表：`session/agent-busy`、新增 `session/rewrite-unavailable`、`gateway/bad-request`、`session/attachment-invalid`；旧的 `reject(...)`/`rejectFailure(...)` 辅助已不存在。
- `packages/api/session-controller/tests/fake-api.client.ts` 已不存在，改为扩展 `tests/test-remote.ts` 的直连 Remote face。
- 新增回归用例：`packages/api/session-controller/tests/session-rewrite.host.spec.ts`（5 例，校验/投递）与 `packages/core/agent-loop/tests/edit-rewrite.spec.ts`（2 例，surface replace + 派生请求真正回退）。

**升级后重放清单**：

1. `node scripts/apply-host-patch.mjs`（默认 `/root/deepseek-harness`，可用 `DSH_CHECKOUT` 或参数覆盖；已应用则直接退出 0）。
2. `pnpm run build:lib && pnpm run build:web`（在 dsh checkout 内）。
3. `systemctl restart deepseek-harness.service`。
4. `DSH_AUTH_USER=kola DSH_AUTH_PASS=… node scripts/e2e-verify-rewrite.mjs`（Playwright 真机验证：发消息 → 编辑 → 重发 → 断言旧文本消失、新文本出现、无错误提示）。

> 升级插件的流程是 `git stash → git pull --ff-only → git stash pop`；当 pop 因上游改动冲突时，
> 工作区会留下冲突标记且改动仍留在 stash 里（2026-08-31 就是这样丢的）。此时先
> `git checkout -- <冲突文件>` 回到干净状态，再跑第 1 步的 `apply-host-patch.mjs`
> （补丁带 `--3way`，能落到新的上游形态上）。

**验证状态（2026-09-17 已完成）**：

- 单测：`packages/api/session-controller` + `packages/core/agent-loop` 共 1169 例全绿，含新增 7 例
  （`session-rewrite.host.spec.ts` 5 例、`edit-rewrite.spec.ts` 2 例）；toolkit 自身 `npm test` 65 例全绿。
- 真机 e2e：`node scripts/e2e-verify-rewrite.mjs`（需 `DSH_AUTH_PASS`）连续三次 **PASS**。
  实测证据：`POST /api/session/rewrite` 返回 `{ok:true,value:{accepted:true}}`；提交后编辑器关闭、
  旧的用户气泡与旧 assistant 回复从转录中消失、编辑后的气泡出现（`ORIGINAL holders: []`）。
  旧气泡能被擦除本身就证明 host 落盘的是 surface `replace`（客户端只在
  `surfaceOp.op === 'replace'` 时才抑制旧事件），与 `edit-rewrite.spec.ts` 的「派生请求历史
  只含改后内容」互为证据。探测文案显式禁止调用工具，运行不留副作用文件。
- 日志：`/tmp/rewrite-e2e.log`（成功运行）、`/tmp/rewrite-verify-runner.log`（重启编排）。

**一个记录在案的次要现象**：

- 会话标题（会话头部面包屑 `*_crumb`、侧栏行 `*_summaryText`）来自自动生成的标题，
  改写后可能仍显示旧文案（改写只替换对话消息，不重算标题）。首版 e2e 把整页文本
  当作转录断言，于是把标题残留误判为「旧消息没被擦除」（2026-09-17 15:53 的那次失败即此），
  现已把断言限定在转录区域（排除标题 chrome），连续两次 PASS。
  M9 之后：**fallback 标题**会在其输入被遮蔽时重算，**provider/用户标题**仍按语义保留
  （provider 输入已过滤掉被遮蔽消息，下一次 all-prompts 重算不会再看到它们）。

## 8. 投影残留与修复（D2，2026-09-17）

**症状**：转录已原地改写（e2e PASS），但 `E2E-D2` 探针显示被擦除的原话仍留在派生状态里：
`~/.dsh/storages/session_projcache/sessions/<id>.json` 的 `turnOutline.turns[0].prompt` 与
`titleInput.first.text` 都还是 `… 第一条`，且两个投影都已追平到最新 seq（不是没处理，
是处理了也不回收）。用户可见后果：回合导航轨的 outline 回落预览（`ui-chat/turn-rail-items.ts`
"loaded window first, outline fallback"）会重新展示被擦除的回合，标题输入也仍以被擦除的消息打底。

**根因**：host 投影是 append-only fold，不识别 surface `replace`。改写事件
（`source.origin === 'edit'`）到达时 `session-turn-outline` 与 `session-title` 的 `titleInput`
照常累积。也就是说「擦除」有三条独立派生路径，只有两条实现了：客户端转录
（`ui-conversation` 的 `rewriteFiltered`）与模型 surface（agent loop 的 replace），投影这条漏了。

**修复**（判别式：`user/message` 且 `source.origin === 'edit'` 且带 replace；
compaction 的同款 replace 不带 `origin`，必须保持原样——它的内容留在转录里）：

- `session-turn-outline`：fold 状态新增与 `turns` 对齐的 `promptSeqs`（host-only，不上 wire，
  `stateVersion` 2→3）。改写按 `[startSeq, endSeq]` 丢弃 **promptSeq 落在区间内**的条目：
  按「条目自己的开场 prompt」而不是 `turn/start` seq 判定，因此改写同回合的后一条 steer 时，
  该回合的开场 prompt 与条目都保留。
- `session-title`：`titleInput`（`stateVersion` 3→4）在遮蔽包含 `first` 时把 first 重置为改写消息
  （此后没有更早的幸存者，count 归 1）；`collectSessionTitleMessages` 扫描原始日志时先弹出
  被遮蔽的消息，provider 输入不会带回被擦除的内容；服务在「站着的 fallback 标题来源被遮蔽」
  时重算一次 fallback（provider/user 标题保留，理由见上）。
- 回归用例：`session-turn-outline/tests/projection.spec.ts`（+3：改写丢弃、改写 steer 保留、
  非改写 replace 保留）、`session-title/tests/projection.spec.ts`（+2）、
  `session-title/tests/provider.spec.ts`（+2：provider 输入过滤、fallback 重算）。
- 顺带修掉补丁内 `session-rewrite.host.spec.ts` 的图片块类型笔误
  （`{type:'image', attachment}` → `{type:'image', mediaType, data}`）；该文件此前的类型错误
  被增量 `tsc -b` 缓存掩盖，改到 session 包后重新全量检查才暴露。

**验收**：补丁扩到 20 个文件（新增 `session-title`/`session-turn-outline` 的 6 个文件），
`git apply --check -R` 与工作区完全一致；重建 lib + 重启后跑
`scripts/e2e-verify-rewrite.mjs`，并追加投影残留检查（扫 projcache 中含 `E2E-RW-` 的会话，
断言不再出现「第一条」），结果写在 `/tmp/rewrite-verify-runner.log`。