<p align="center">
  <img src="docs/assets/hero.svg" alt="dsh-plugin-toolkit — DeepSeek Harness 的实用小优化集合" width="100%">
</p>

<p align="center">
  <a href="README.md">English</a> · <b>简体中文</b>
</p>

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的个人小优化工具包。每个优化都足够小、不值得独立成垂直插件，于是统一收纳在同一张 Toolkit 设置卡片里：**Web 设置 → 插件 → DSH-Toolkit** 展开一个半宽两列的子卡片网格（图标、标题、副标题、开关徽标），点击某个子卡片即可打开该优化的设置弹窗。优化项变多时，插件页依然只是紧凑的入口清单。

所有实现都走公开扩展面——settings 命名空间、客户端模块表、会话槽位、`llm/stream`、模型发现与 `webServer` 路由——因此不改动任何 dsh 核心包，上游一键升级不受影响。

## 目录

- [一览](#一览)
- [安装（web profile）](#安装web-profile)
- [架构](#架构)
- [设置卡片](#设置卡片)
- [优化项](#优化项)
  - [`workspacelessChat`](#workspacelesschat)
  - [`editLastMessage`](#editlastmessage)
  - [`viewActivity`](#viewactivity)
  - [`slashI18n`](#slashi18n)
  - [`changeReport`](#changereport)
  - [`opencodeSession`](#opencodesession)
  - [`modelCapability`](#modelcapability)
- [配置总览](#配置总览)
- [开发](#开发)
- [毕业规则](#毕业规则)
- [模型体验](#模型体验)
- [许可证](#许可证)

## 一览

| # | 优化项 | 作用 | 默认 | 所在半边 |
|---|---|---|---|---|
| 1 | [`workspacelessChat`](#workspacelesschat) | 维护一个无项目对话工作区，并在冷启动时自动接入 | 开 | 客户端 + 服务端 |
| 2 | [`editLastMessage`](#editlastmessage) | 编辑上一条用户消息并重发，模型上下文真正回退 | 开 | 客户端 |
| 3 | [`viewActivity`](#viewactivity) | 侧栏「活动」图标：运行中优先，再按 今天/昨天/星期X/更早 分组 | 开 | 客户端 |
| 4 | [`slashI18n`](#slashi18n) | 「/」菜单的命令与技能描述显示中文 | 开 | 客户端 |
| 5 | [`changeReport`](#changereport) | 回合尾部 codex 风格的改动报告卡片 | 开 | 客户端 |
| 6 | [`opencodeSession`](#opencodesession) | 为 OpenCode Go/Zen 请求补上稳定的 `x-opencode-session` | 开 | 服务端 |
| 7 | [`modelCapability`](#modelcapability) | 保持某条 llm-pi-ai 路由的模型清单、容量与图像能力最新 | 开 | 服务端 + 客户端 |

## 安装（web profile）

```sh
cd ~/.dsh/profiles/web
pnpm add file:/path/to/dsh-plugin-toolkit   # 开发期可用 link:/path/to/dsh-plugin-toolkit
# 把 "dsh-plugin-toolkit" 加进 package.json 的 dsh.profile.bundles 列表
systemctl restart deepseek-harness.service  # 或你的 profile 重启方式
```

服务端变更（本包）需要重启 profile；客户端 bundle 需要在 profile 内 `pnpm install` 重新同步后浏览器硬刷新生效。开关、路径与模型清单都是 settings 命名空间的值，日常修改实时生效、无需重启。

## 架构

<p align="center">
  <img src="docs/assets/architecture.svg" alt="架构：浏览器客户端半边、dsh 服务端半边，以及 OpenCode 与 models.dev 外部服务" width="100%">
</p>

本包分为浏览器半边与服务端半边，两者读取同一个 `toolkit` settings 命名空间，且都不改 dsh 源码。

| 半边 | 文件 | 职责 | 使用的扩展面 |
|---|---|---|---|
| 客户端 | `client.js` | 设置卡片、内联编辑 UI、侧栏重排、「/」菜单改写、改动报告卡片、模型 id 选择器 | 客户端模块表、会话节点/回合尾部槽位、`remote.*` 命名空间包装、settings scope |
| 服务端 | `index.js` | 设置 schema 与默认值、默认对话工作区目录、OpenCode 会话头 | `settings`、`llm/stream`、`globalThis.fetch` |
| 服务端 | `model-sync.js` + `models-core.js` | 模型发现包装、同步/清单路由、容量与模态补全 | `llm` 模型发现、`webServer` 路由、settings 存储 |

全包一致的设计原则：

- **不改核心。** 每个挂点都是官方扩展面，上游升级不会与本工具包冲突。
- **休眠而非报错。** 缺少某个扩展面（旧 host、无 `webServer`、无 `session.rewrite`）只会让对应优化失效，界面其余部分不受影响。
- **配置实时生效。** 每个开关与字段都存放在 `toolkit` settings 命名空间，使用时实时读取。
- **各自独立开关。** 任一优化都可从子卡片关闭，并逐字恢复原生行为。

## 设置卡片

<p align="center">
  <img src="docs/assets/settings-card.svg" alt="DSH-Toolkit 设置卡片：七个半宽优化子卡片，各有图标、标题、标识与开关徽标" width="100%">
</p>

卡片为每个优化渲染一张子卡片，带实时开关徽标，以及「全部启用 / 全部关闭」两个快捷按钮。打开子卡片会显示该优化自己的说明与字段（例如默认对话目录，或模型能力的 Key 与选择器）。

## 优化项

### `workspacelessChat`

不选工作区也能直接对话，即其他 agent 的默认项目行为。dsh 的输入框要求空白会话必须归属某个工作区，因此本优化维护一个专用的「**通用对话**」无项目工作区：只要优化开启，客户端就幂等地创建它并命名为友好标题，侧边栏和工作区下拉里始终有这个选项——点它就是不选项目直接聊。

此外，当两个基线就绪、当前无选中会话、且运行时自身的启动策略没有可接的最近工作区（首次运行、无任何工作区）时，客户端还会自动接入其中的空白会话，输入框立即可用。

<p align="center">
  <img src="docs/assets/flow-workspaceless-chat.svg" alt="冷启动判定：运行时自己的最近工作区自动接入优先；否则工具包确保对话工作区存在，并自动接入一个空白会话" width="100%">
</p>

冷启动自动接入失败时最多重试 3 次（间隔 2 秒），之后休眠，直到列表变化重新触发检查。运行时自身的最近工作区自动接入永远优先；本优化只填补「无可接入」的空档，而工作区本身无条件存在。仅当工作区仍带自动推导的基名时才会被改名为友好标题（你自己设置过的标题不会被覆盖）。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.workspacelessChat` | `true` | 无项目对话工作区 + 自动接入开关。 |
| `chatWorkspacePath` | `""` | 默认对话工作区的主机目录；留空解析为 `<DSH_HOME>/chat`。目录由服务端创建（改设置也实时生效）。 |
| `chatWorkspaceTitle` | `通用对话` | 无项目对话工作区的显示标题。 |

卡片写入走 `toolkit` settings 命名空间，因此开关与路径修改实时生效、无需重启。

### `editLastMessage`

重试失败的回答时，既不用复制粘贴，也不污染模型上下文：上一条用户消息的悬浮操作里多出一个**编辑**按钮。点击后就地打开预填该消息的编辑器；**保存并重发**会原位改写会话——被编辑的消息及其之后的全部内容被替换（模型上下文真正回退，下一次请求只含编辑后的内容），并由新回合回答这条编辑后的消息。

<p align="center">
  <img src="docs/assets/flow-edit-resend.svg" alt="改写前后对比：旧消息与失败回合从转录和派生模型历史中被擦除" width="100%">
</p>

这需要 host 支持 `session.rewrite` RPC（本仓库 dsh checkout 的小幅新增）。在不支持的 host 上按钮仍会显示，但会提示不支持改写。客户端转录会擦除旧消息与其失败回合；回合边界保留，使失败回合折叠为不可见的空回合。需要会话空闲（运行中会以 `agent-busy` 拒绝）；仅最后一条人类用户消息可编辑，且仅限纯文本。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.editLastMessage` | `true` | 上一条用户消息上的编辑并重发按钮。 |

### `viewActivity`

在工作区侧栏添加一个**活动**图标（原生时钟字形），位置紧跟在搜索（放大镜）控件之后。点击后**就地重排侧栏会话列表**：运行中的对话浮到顶部「**优先级**」组，其余历史按「**今天 / 昨天 / 星期X / 更早**」分组（组内新者在前）——就是熟悉的「最近对话」模式。再点一次恢复之前的分组（工作区分段或平铺列表）；活动排序开启时图标高亮。

<p align="center">
  <img src="docs/assets/flow-view-activity.svg" alt="默认按工作区分段的侧栏，与「运行中优先、再按日期分组」的活动视图对比" width="100%">
</p>

> 100% 非侵入式外部实现：把活动开关挂进侧栏头部、动态替换会话树，零改动官方 DSH 核心包，与上游一键升级零冲突。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.viewActivity` | `true` | 工作区头部活动图标 + 就地运行中优先/按日重排。 |

### `slashI18n`

「/」菜单的外壳文案（分组标题、仅用户徽标、骨架行）本已本地化，但条目描述直接来自 host：内置命令描述、参数提示、技能目录描述在中文界面下也原样显示英文。本优化在**客户端**翻译它们：工具包包装 `remote.commands.list` 与 `remote.skills.list` 两个命名空间方法，在任何消费者读取之前，用精确匹配的 en→zh 词典改写响应里的 `description` / `input.hint`。

<p align="center">
  <img src="docs/assets/flow-slash-i18n.svg" alt="斜杠菜单的远程清单响应在渲染前经词典改写；未命中则回退英文" width="100%">
</p>

范围与安全边界：

- `name` 字段永不翻译——模糊匹配、草稿 chip 词表与主张判定都读取它；`whenToUse` / `modelInvocable` 同样原样保留。
- 词典未命中时回退原字符串，因此 dsh 更新改写描述后最多退化回英文，直到词典跟上（绝不会让菜单出错）。
- 仅在界面语言为中文时生效；设置开关按每次 RPC 结果重新读取，因此切换后在下一次打开菜单时立即生效。
- 结果会重建为新对象，调用方缓存不会与线上数据别名；reject 与错误结果原样透传；重复应用插件不会双重包装。
- 你自己编写的技能直接在 `SKILL.md` frontmatter 里写中文 `description` 即可，无需词典。词典只覆盖 dsh 自带内容（6 个内置命令、2 条尚未由 ui-conversation 自身 `hint.*` 键覆盖的提示、以及 2 个内置技能）。
- 不需要改 dsh 源码，也不需要 host 扩展；host 没有这些命名空间时本优化安静休眠。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.slashI18n` | `true` | 「/」菜单命令与技能的中文描述。 |

### `changeReport`

每个完成的回合尾部都会出现 codex 风格的改动报告。当该回合改动了文件（`edit` / `write` / 变更型 `str_replace_editor` 调用）时，尾部渲染一张紧凑卡片：**「已编辑 N 个文件 · +A -R」**，每个文件一行、各带自己的 `+N -M`（点击某行可在查看器中打开该文件），超过四行出现「再显示」展开器，并有**审核**按钮打开该回合完整 diff。这张卡片是 dsh 内置「产出文件」尾部的超集：它接入同一条 `conversation.chat.turnTail` 链并排在前面（优先级更低），在无改动回合上主动让位，因此原生尾部显示与之前完全一致。

<p align="center">
  <img src="docs/assets/flow-change-report.svg" alt="变更类工具调用汇入客户端累加器，渲染出带每文件行数与审核按钮的回合改动卡片" width="100%">
</p>

工作方式与边界：

- 数据来自转录、在客户端聚合：会话回合数据累加器为每次成功的变更调用记录一份 before/after hunk——既包括 agent 直接工具调用，也包括 `run_code` 的嵌套子调用（它们以根调用为键记录为 `tool/code-dispatch` 事件）。行数复用同名原语的 `diffTotals`，因此头部数字与审核 `DiffBlock` 渲染的始终一致。
- `bash` 侧的文件写入（sed、重定向等）对转录不可见，因此不追踪——报告覆盖专用的文件变更工具，与 codex 追踪自己的工具同理。
- 失败的调用（工具错误结果）不计入；收尾 assistant seq 之后的结算被排除；聚合结果每次渲染重建（不与线上数据别名）。
- 不含**撤销**：在磁盘上回滚文件需要浏览器不具备的 host 能力。主动让位是有意为之——V1 只做展示。
- 不改 dsh 源码：槽位、回合数据定义注册表与 diff 原语都是公开扩展面。关闭开关即逐字恢复原生尾部。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.changeReport` | `true` | 回合尾部的改动报告卡片。 |

### `opencodeSession`

OpenCode Go 现在会 400 拒绝缺少 `x-opencode-session` 的请求（`{"type":"MissingSessionID", ...}`），其规范也要求编码 agent 以自己的 user agent 标识自身，并每段对话发送一个稳定会话 ID，便于网关路由请求、复用提示词缓存。user agent 部分已经满足——每个 dsh provider 请求都带 `deepseek-harness/<version>` 归属标识。本优化完全从插件侧补齐会话 ID 这一半：`llm/stream` 监听器通过 `AsyncLocalStorage` 把在途请求的会话身份沿异步链传递下去，一个轻量的启动期 `globalThis.fetch` 包装为所有目标主机是 `opencode.ai` 或其子域的请求补上该头（Go 与 Zen 一视同仁）。

<p align="center">
  <img src="docs/assets/flow-opencode-session.svg" alt="llm/stream 监听器把会话身份写入 AsyncLocalStorage；fetch 包装为 opencode.ai 请求补头，其余请求原样转发" width="100%">
</p>

工作方式与边界：

- 该 ID 就是 dsh 为每个请求都已附加的 loop 级会话身份（agent-loop 不变量要求如此），因此按构造天然每对话稳定——新对话新 ID；同一对话在跨回合、重试、压缩与标题生成中保持同一 ID。
- 不携带会话身份的调用（罕见的手工一次性请求；也包括模型发现）回退为每进程一个 ID，而不是被网关以 `MissingSessionID` 拒绝。
- 包装只安装一次（带标记防重复），仅在缺失时补头，任何装饰失败都回落到原始 fetch——绝不会弄坏请求。非 OpenCode 请求逐字节原样通过。
- Provider SDK 每个请求都会解析全局 fetch（pi-ai 每次流式调用都新建客户端），因此启动期包装无需改动 dsh 源码，也能在一键升级后继续生效。
- 与 `viewActivity` 一样是 100% 非侵入式外部实现：零改动 dsh 核心包。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.opencodeSession` | `true` | OpenCode Go/Zen 请求上每对话稳定的 `x-opencode-session`。 |

### `modelCapability`

把 llm-pi-ai 某个路由（默认 `opencode-go`）的模型清单与端点实时清单保持同步：端点新增的模型立即出现在选择器中、无需重启；缺失的上下文/输出上限由 [models.dev](https://models.dev) 注册表与同族模型补全；图像输入按其他已注册 provider 的同 id 声明借用；还可以强制某个模型支持或不支持图像。本项原为 `dsh-plugin-quota-badges` 的「模型能力」分区，现整体迁入 Toolkit，原插件不再包含该功能。

<p align="center">
  <img src="docs/assets/flow-model-capability.svg" alt="实时清单、已装目录、models.dev 注册表、同族 provider 与用户覆盖汇入纯合并核心，再写入 llm-pi-ai 路由并服务 GUI 与 API 面" width="100%">
</p>

工作方式与边界：

- **发现包装**：包装运行时的 llm-pi-ai 模型发现，让 GUI 的「获取可用模型」返回「实时清单 ⊕ 已安装目录」的并集，而不是只有目录。包装带 `enrichedByToolkit` 标记：只有真正 probe 成功的答案才会被同步路由当作实时清单，探测失败回退目录，绝不会把已存路由写瘦。**卡片上没有「同步模型列表」按钮**：模型清单的更新走 dsh 自己的模型设置（点「获取可用模型」，清单由你确认后写入），避免一键把实时清单整体灌进路由；同一个动作的服务端路由 `POST /api/toolkit/sync-models` 仍然注册，只在被显式调用时生效（API/脚本用）。
- **可搜索的模型选择器**：强制视觉 / 强制纯文本不再是逗号分隔的 id 文本框，而是按 id 或名称即时过滤的下拉选择器：点击候选加入为 chip、chip 上的 × 取消、输入框里回车可把候选外的 id 直接加入，Backspace 删除最后一个 chip。候选来自 `GET /api/toolkit/models`（该路由的 stored 条目 ∪ 运行时 listModels，按 id 去重排序，纯进程内读取、不发网络请求），弹窗每次打开时拉取一次——它只读当前已配置的模型，不改动任何东西。两个列表互斥：加入视觉会自动从纯文本移除，反之亦然。
- **启动修复**：给路由预写 wire protocol（`api`），让配置界面自身的保存也能通过服务性校验；并修复已存模型缺失的图像输入（配置界面保存时不带 `input` 字段）。强制视觉/纯文本列表一改动就立即作用于已存模型，无需重启或再同步。
- **一次性迁移**：首次启动时若 `modelsApiKey` 为空，会从旧的 `quota-badges` 命名空间取用原 OpenCode Key、强制视觉/纯文本列表与路由形状；迁移标记与数据同一次写入，之后即使清空 Key 也不会被回填。
- 主机缺少 settings / llm / webServer 任一面时本项静默休眠，不影响其它优化；所有逻辑都在本包内，不改 dsh 源码。

| 配置 | 默认 | 含义 |
|---|---|---|
| `optimizations.modelCapability` | `true` | 模型能力（发现包装 + 同步路由 + 能力修正）总开关。 |
| `modelsApiKey` | `""` | OpenCode API Key；留空回退环境变量。 |
| `modelsApiKeyEnvVar` | `OPENCODE_API_KEY` | 未填 Key 时读取的环境变量。 |
| `modelsRouteKey` | `opencode-go` | 保持最新的 llm-pi-ai 路由。 |
| `modelsBaseURL` | `https://opencode.ai/zen/go/v1` | 探测实时模型清单的端点。 |
| `modelsRouteApi` | `openai-completions` | 预写到路由上的 wire protocol。 |
| `modelsSyncPath` | `/api/toolkit/sync-models` | 显式同步的 same-origin 路由（卡片上没有入口，仅供 API/脚本；改动需重启）。 |
| `modelsPath` | `/api/toolkit/models` | 选择器候选模型的 same-origin 路由（改动需重启）。 |
| `modelsEnrichFromRegistry` | `true` | 是否用 models.dev 注册表补全缺失容量/模态。 |
| `modelsRegistryProvider` | `opencode-go` | models.dev 中对应的 provider 目录名。 |
| `modelsVision` | `[]` | 强制支持图像输入的模型 id。 |
| `modelsTextOnly` | `[]` | 强制去掉图像输入的模型 id。 |
| `modelsTimeoutSec` | `10` | 探测与注册表请求的超时（秒）。 |

> 说明：本项含服务端路由与独立配置字段，按下面的「毕业规则」已达到可拆出的体量；当前有意保留在 Toolkit 内，作为编号优化项统一管理。

## 配置总览

所有字段都在 `toolkit` settings 命名空间。组合默认值声明在 `cordis.patch.yml`，schema 在 `index.js`，公开类型在 `index.d.ts`。

| 字段 | 类型 | 默认 | 归属 |
|---|---|---|---|
| `optimizations.workspacelessChat` | boolean | `true` | workspacelessChat |
| `optimizations.editLastMessage` | boolean | `true` | editLastMessage |
| `optimizations.viewActivity` | boolean | `true` | viewActivity |
| `optimizations.slashI18n` | boolean | `true` | slashI18n |
| `optimizations.changeReport` | boolean | `true` | changeReport |
| `optimizations.opencodeSession` | boolean | `true` | opencodeSession |
| `optimizations.modelCapability` | boolean | `true` | modelCapability |
| `chatWorkspacePath` | string | `""` → `<DSH_HOME>/chat` | workspacelessChat |
| `chatWorkspaceTitle` | string | `通用对话` | workspacelessChat |
| `modelsApiKey` | string | `""` | modelCapability |
| `modelsApiKeyEnvVar` | string | `OPENCODE_API_KEY` | modelCapability |
| `modelsRouteKey` | string | `opencode-go` | modelCapability |
| `modelsBaseURL` | string | `https://opencode.ai/zen/go/v1` | modelCapability |
| `modelsRouteApi` | string | `openai-completions` | modelCapability |
| `modelsSyncPath` | string | `/api/toolkit/sync-models` | modelCapability |
| `modelsPath` | string | `/api/toolkit/models` | modelCapability |
| `modelsEnrichFromRegistry` | boolean | `true` | modelCapability |
| `modelsRegistryProvider` | string | `opencode-go` | modelCapability |
| `modelsVision` | string[] | `[]` | modelCapability |
| `modelsTextOnly` | string[] | `[]` | modelCapability |
| `modelsTimeoutSec` | number | `10` | modelCapability |

## 开发

```sh
npm test          # node --test tests/*.test.js（models-core、model-sync、settings-card）
npm run smoke     # 插件 bundle 的服务端冒烟检查
```

| 路径 | 内容 |
|---|---|
| `index.js` / `index.d.ts` | 服务端半边：settings 命名空间、对话目录、OpenCode fetch 包装。 |
| `model-sync.js` | 服务端半边：发现包装、同步/清单路由、补全与迁移。 |
| `models-core.js` | 纯合并/补全/diff 辅助函数（无网络、无 settings 访问）。 |
| `client.js` | 浏览器半边：设置卡片与全部客户端优化。 |
| `cordis.patch.yml` | 注入 dsh bundle patch 的组合默认值。 |
| `tests/` | 纯核心、同步路由与设置卡片的单元测试。 |
| `scripts/` | 冒烟、e2e 与验证脚本。 |
| `docs/assets/` | 本 README 系列使用的 SVG 图。 |

## 毕业规则

任一优化满足以下条件时，应从本包拆出为独立的 `dsh-plugin-*`：

- 长出超出单行开关的设置 GUI、服务路由、后台任务或独立的 `client.js` 功能面；
- 需要按组合行单独启停（Cordis 按整行启停，不能只关单个优化）；
- 定义加测试超过约 200 行；
- 值得独立发布或分享。

## 模型体验

不注册 tool、不改任何提示词表面，纯 UI/运行时易用性优化。唯一例外是 `editLastMessage` 的改写：按设计它会改变模型看到的内容——编辑后，被擦除的旧尾会从派生请求历史中移除（通过 surface `replace`），后续回合只读取编辑后的内容。

## 许可证

[MIT](LICENSE)
