/**
 * dsh-plugin-toolkit - Client half (v0.1.0)
 *
 * Personal quality-of-life toolkit for the DeepSeek Harness Web client.
 *
 *  1. workspacelessChat - when no session is selected and the runtime's own
 *     startup policy has nothing to connect (first run, no workspaces), the
 *     client ensures a default chat workspace exists and connects it, so the
 *     composer is live without the user picking a workspace. dsh's composer
 *     requires a blank session to belong to a workspace, so "workspaceless"
 *     is delivered as an auto-connected default workspace.
 *
 *  2. A settings card on the Web plugins page (slot `settings.plugin.item`,
 *     key `toolkit` - must equal the server-registered settings namespace).
 *     Clicking the card EXPANDS it into one half-width sub-card per
 *     optimization; each sub-card carries its own toggle and, for the ones
 *     that have options, a settings dialog of its own.
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-toolkit",
  factory: (require) => {
    const exports = {};
    const React = require("react");
    const { useState, useEffect, useLayoutEffect, useRef, memo } = React;
    const { jsx, jsxs } = require("react/jsx-runtime");
    const {
      Modal, IconChevronDownOutline14, projectUserText, JsonBlock,
      IconCopyOutline16, IconCheckOutline16, Tooltip,
      FileTypeIcon, fileExtension, fileSizeText,
      IconPersonalizationOutline16, IconNewChatOutline16, IconEditOutline16,
      IconClockOutline16, IconGlobeOutline14, diffTotals,
      IconBranchOutline16, IconApiOutline14,
      IconGaugeOutline16,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

    /** Fallback model route; the live value comes from the settings section. */
    const MODELS_PATH = "/api/toolkit/models";

    function ClockIcon() {
      return jsx("svg", {
        width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true",
        children: [
          jsx("circle", { cx: 8, cy: 8, r: 6.5, stroke: "currentColor", strokeWidth: 1.3 }),
          jsx("path", { d: "M8 4.5v3.5l2 1.5", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round" }),
        ],
      });
    }

    function MessageIconActions(props) {
      const { text, time, clock = "end", t, extraActions } = props;
      const [copied, setCopied] = useState(false);
      const copy = () => {
        if (text === undefined) return;
        // Feature-detect: `navigator.clipboard` is undefined outside a secure
        // context, and a denied write rejects (Safari/Firefox permissions).
        // Either way the button must not claim a copy that did not happen.
        const clipboard = globalThis.navigator?.clipboard;
        if (typeof clipboard?.writeText !== "function") return;
        clipboard.writeText(text).then(
          () => { setCopied(true); },
          (error) => { console.warn("[toolkit] clipboard write failed:", error); },
        );
      };
      useEffect(() => {
        if (!copied) return;
        const timer = setTimeout(() => { setCopied(false); }, 1500);
        return () => { clearTimeout(timer); };
      }, [copied]);

      const formatTime = (ts) => {
        if (!ts) return "";
        const d = new Date(ts);
        return isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5);
      };

      const clockEl = time !== undefined ? jsxs("span", {
        style: {
          display: "inline-flex", alignItems: "center", gap: "4px",
          fontSize: "12px", color: "var(--dsw-alias-label-tertiary, #9ca3af)",
        },
        children: [
          jsx(ClockIcon, {}),
          jsx("span", { children: formatTime(time) }),
        ],
      }) : null;

      return jsxs("div", {
        style: {
          display: "flex", alignItems: "center", gap: "6px",
          marginTop: "2px",
        },
        children: [
          clock === "start" ? clockEl : null,
          extraActions,
          text !== undefined ? jsx(Tooltip, {
            label: copied ? (t ? t("msgCopied") : "已复制") : (t ? t("msgCopy") : "复制"),
            side: "bottom",
            children: jsx("button", {
              type: "button",
              onClick: copy,
              style: {
                flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "24px", height: "24px", borderRadius: "6px", padding: 0,
                font: "inherit",
                color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                background: "transparent",
                border: "1px solid transparent",
                cursor: "pointer",
              },
              onMouseEnter: (event) => {
                event.currentTarget.style.color = "var(--dsw-alias-label-primary, #f3f4f6)";
                event.currentTarget.style.background = "rgba(148, 163, 184, 0.18)";
              },
              onMouseLeave: (event) => {
                event.currentTarget.style.color = "var(--dsw-alias-label-tertiary, #9ca3af)";
                event.currentTarget.style.background = "transparent";
              },
              children: copied ? jsx(IconCheckOutline16, {}) : jsx(IconCopyOutline16, {}),
            }),
          }) : null,
          clock === "end" ? clockEl : null,
        ],
      });
    }

    // ── locale ────────────────────────────────────────────────────────────────

    const NS = "toolkit";
    const zh = {
      cardTitle: "DSH-Toolkit",
      cardDesc: "实用小优化集合",
      cardOpen: "展开 DSH-Toolkit 配置",
      cardStatus: "已启用 {enabled}/{total}",
      quickOn: "全部启用",
      quickOff: "全部关闭",
      close: "关闭",
      done: "完成",
      statusSaved: "已保存",
      statusReadOnly: "设置只读（Host 文档不可写）",
      statusMemory: "设置仅保存在本进程内存",
      statusLoading: "正在读取设置…",
      optChatTitle: "免选工作区对话",
      optChatShort: "打开即可对话，无需先选工作区",
      optChatDesc:
        "打开页面且没有可自动接入的工作区时，自动接入默认 chat 工作区，无需先选择工作区即可直接对话（即其他 agent 的默认项目行为）。",
      chatPathLabel: "默认对话目录",
      chatPathHint:
        "留空使用 <DSH_HOME>/chat。目录由服务端自动创建；修改后下一次自动接入即生效。",
      chatPathSave: "保存",
      toggleOn: "已开启",
      toggleOff: "已关闭",
      saveError: "保存失败",
      optEditTitle: "编辑上一条并重发",
      optEditShort: "改上一条消息，重新发送",
      optEditDesc:
        "点击上一条消息旁的编辑按钮，直接修改内容并发送——该消息之后的内容会被移除，以新内容继续。",
      optEnableLabel: "启用此功能",
      editOpen: "编辑",
      editHintInline: "Ctrl+Enter 发送 · Esc 取消",
      editSave: "发送",
      editCancel: "取消",
      editBusy: "发送中…",
      editUnsupported: "当前 host 不支持改写",
      editError: "重发失败",
      msgCopy: "复制",
      msgCopied: "已复制",
      msgExtraBlock: "附加内容",
      msgReferenceSummary: "引用了会话 {labels}",
      msgReferenceSeparator: "、",
      msgTruncated: "已截断（{total} 项）",
      optActivityTitle: "查看活动",
      optActivityShort: "最近对话按运行中 + 日期分组",
      optActivityDesc:
        "在工作区侧栏添加一个「活动」图标：点击后侧栏会话列表就地重排——运行中的对话置于顶部「优先级」组，其余按 今天/昨天/星期X/更早 分组；再点一次恢复原分组。",
      activityOpen: "查看活动",
      activityBtnActive: "按工作区分组查看",
      activityBtnInactive: "会话活动视图（按时间 / 进行中分组）",
      activityPriority: "进行中",
      activityToday: "今天",
      activityYesterday: "昨天",
      activityEarlier: "更早",
      activityEmpty: "暂无会话",
      activityRunning: "正在运行",
      activityDone: "已完成",
      activityNewSession: "新会话",
      activityJustNow: "刚刚",
      activityMinutesAgo: "{n} 分钟前",
      activityHoursAgo: "{n} 小时前",
      activityYesterdayAt: "昨天 {time}",
      optI18nTitle: "斜杠菜单中文描述",
      optI18nShort: "/ 菜单的命令与技能描述显示中文",
      optI18nDesc:
        "将「/」菜单里 host 返回的命令/技能英文描述按内置词典译为中文（仅界面显示，条目名与执行不变）。未收录的文案保持原文；dsh 更新改写文案后词典未命中会自动回退英文。仅在界面语言为中文时生效。",
      optReportTitle: "改动报告",
      optReportShort: "回合结束后汇总本轮文件改动",
      optReportDesc:
        "每回合结束后，若本轮有文件改动（edit / write / str_replace_editor），在回合尾部显示改动报告卡片：文件数与 +N -M 汇总、按文件行数清单（点击打开文件）、审核按钮弹出完整 diff。不追踪 bash 内的文件写入；不含撤销功能。",
      optSessionTitle: "OpenCode 会话头",
      optSessionShort: "为 OpenCode Go 请求补上 x-opencode-session",
      optSessionDesc:
        "OpenCode Go 要求每个请求携带 x-opencode-session（每段对话一个稳定会话 ID），缺失会被 400 拒绝。开启后，发往 opencode.ai（Go/Zen）的请求会自动带上当前对话的会话 ID，用于服务端路由与提示词缓存。100% 插件侧实现，不改 dsh 源码、不影响一键升级；User-Agent 已由 dsh 自身标识满足。",
      optModelsTitle: "模型能力",
      optModelsShort: "同步模型清单、补全上下文与图像能力",
      optModelsDesc:
        "把端点实时的模型清单与已安装目录合并后写入 dsh 的 llm-pi-ai 路由：新增模型立即出现在选择器中、无需重启。缺失的上下文/输出上限由 models.dev 注册表与同族模型补全；图像输入按其他已注册 provider 的同 id 声明借用；也可在此强制某个模型支持或不支持图像。",
      modelsKeyLabel: "OpenCode API Key",
      modelsKeyPlaceholder: "粘贴 opencode.ai 的 API Key",
      modelsKeyHint: "留空时回退读取环境变量 {env}",
      modelsInfoTitle: "模型清单与能力",
      modelsInfoDesc:
        "候选来自该路由（{route}）当前已配置的模型，保存后立即生效。要新增模型请到 dsh 自己的模型设置里点「获取可用模型」：本插件把该动作接到了实时端点，拉到的清单由你确认后再写入目录。",
      modelsVisionLabel: "强制视觉模型",
      modelsVisionHint: "从该路由的已知模型里搜索选择；加入视觉会自动从纯文本里移除，保存后立即生效。",
      modelsTextOnlyLabel: "强制纯文本模型",
      modelsTextOnlyHint: "从该路由的已知模型里搜索选择；加入纯文本会自动从视觉里移除，保存后立即生效。",
      modelsPickSearch: "搜索模型 id 或名称…",
      modelsPickLoading: "正在加载模型列表…",
      modelsPickFailed: "模型列表加载失败：{message}",
      modelsPickUnavailable: "模型列表加载器未注入（插件接线有问题）",
      modelsPickEmpty: "没有匹配的模型",
      modelsPickNoOptions: "该路由暂无已配置的模型：请到 dsh 的模型设置里添加，或直接输入 id 后回车加入。",
      modelsPickAddFree: "回车把 “{id}” 直接加入",
      modelsPickRemove: "移除 {id}",
      modelsPickCount: "已选 {count}",
      modelsSave: "保存",
      slashI18nTitle: "命令与技能翻译管理",
      slashI18nSearchPlaceholder: "搜索命令名或描述关键词…",
      slashI18nFilterAll: "全部",
      slashI18nFilterUntranslated: "仅未翻译",
      slashI18nFilterCommand: "命令",
      slashI18nFilterSkill: "技能",
      slashI18nStats: "共 {total} 项 · {translated} 项已翻译 · {untranslated} 项未翻译",
      slashI18nBatchAi: "一键 AI 翻译",
      slashI18nBatchAiOptimize: "一键翻译并归纳优化",
      slashI18nBatchAiLoading: "AI 翻译中 ({n})…",
      slashI18nBatchAiOptimizeLoading: "AI 归纳中 ({n})…",
      slashI18nSave: "保存翻译",
      slashI18nSavedNotice: "翻译已保存并即时生效",
      slashI18nColName: "名称 / 类型",
      slashI18nColOriginal: "英文原描述",
      slashI18nColTranslation: "中文翻译 (可自由微调)",
      slashI18nPlaceholderTranslation: "请输入中文翻译或点击 AI 操作…",
      slashI18nAiButton: "AI 翻译",
      slashI18nAiOptimize: "翻译并归纳",
      slashI18nResetButton: "恢复默认",
      slashI18nTagBuiltin: "内置",
      slashI18nTagCustom: "自定义",
      slashI18nTagLong: "长文案",
      slashI18nEmptyFilter: "没有匹配的命令或技能",
      reportTitle: "已编辑 {count} 个文件",
      reportTitleOne: "已编辑 1 个文件",
      reportMore: "再显示 {count} 个文件",
      reportShowFolder: "在文件夹中显示",
      reportOpenAria: "打开 {name}",
    };
    const en = {
      cardTitle: "DSH-Toolkit",
      cardDesc: "Practical small optimizations",
      cardOpen: "Expand DSH-Toolkit configuration",
      cardStatus: "{enabled}/{total} on",
      quickOn: "Enable all",
      quickOff: "Disable all",
      close: "Close",
      done: "Done",
      statusSaved: "Saved",
      statusReadOnly: "Settings read-only (host document not writable)",
      statusMemory: "Settings kept in local memory only",
      statusLoading: "Loading settings…",
      optChatTitle: "Chat without picking a workspace",
      optChatShort: "Chat right away without picking a workspace",
      optChatDesc:
        "When the page opens and no workspace can be auto-connected, connect the default chat workspace automatically so conversation works immediately.",
      chatPathLabel: "Default chat directory",
      chatPathHint:
        "Empty uses <DSH_HOME>/chat. The server creates the directory; edits apply from the next auto-connect.",
      chatPathSave: "Save",
      toggleOn: "On",
      toggleOff: "Off",
      saveError: "Save failed",
      optEditTitle: "Edit & resend last message",
      optEditShort: "Edit the last message and send again",
      optEditDesc:
        "Click the edit button next to the last message, change the content, and send — everything after that message is removed and the model continues from the edited content.",
      optEnableLabel: "Enable this feature",
      editOpen: "Edit",
      editHintInline: "Ctrl+Enter to send · Esc to cancel",
      editSave: "Send",
      editCancel: "Cancel",
      editBusy: "Sending…",
      editUnsupported: "This host does not support rewriting",
      editError: "Resend failed",
      msgCopy: "Copy",
      msgCopied: "Copied",
      msgExtraBlock: "Extra content",
      msgReferenceSummary: "Referenced sessions: {labels}",
      msgReferenceSeparator: ", ",
      msgTruncated: "Truncated ({total} items)",
      optActivityTitle: "View activity",
      optActivityShort: "Recent conversations grouped by running + date",
      optActivityDesc:
        "Add an activity icon to the workspace sidebar: clicking it re-sorts the sidebar's conversation list in place - running conversations in a leading Priority group, then history grouped by Today / Yesterday / Weekday / Earlier; click again to restore.",
      activityOpen: "View activity",
      activityBtnActive: "Group by workspace",
      activityBtnInactive: "Activity view (running first, grouped by day)",
      activityPriority: "In progress",
      activityToday: "Today",
      activityYesterday: "Yesterday",
      activityEarlier: "Earlier",
      activityEmpty: "No conversations yet",
      activityRunning: "Running",
      activityDone: "Done",
      activityNewSession: "New conversation",
      activityJustNow: "just now",
      activityMinutesAgo: "{n} min ago",
      activityHoursAgo: "{n} h ago",
      activityYesterdayAt: "Yesterday {time}",
      optI18nTitle: "Chinese slash-menu descriptions",
      optI18nShort: "Show / menu command & skill descriptions in Chinese",
      optI18nDesc:
        "Translate the English descriptions the host returns for '/' menu commands and skills into Chinese via a built-in dictionary (display only; names and execution unchanged). Unlisted text stays as-is, and a dsh update that rewords a description falls back to English until the dictionary catches up. Applies only while the UI language is Chinese.",
      optReportTitle: "Change report",
      optReportShort: "Per-turn file-change summary at the turn tail",
      optReportDesc:
        "After each turn, if it changed files (edit / write / str_replace_editor), a codex-style report card renders at the turn tail: file count with +N -M totals, a per-file line-count list (click opens the file), and a Review button opening the full diff. bash-side file writes are not tracked; undo is out of scope.",
      optSessionTitle: "OpenCode session header",
      optSessionShort: "Send x-opencode-session on OpenCode Go requests",
      optSessionDesc:
        "OpenCode Go requires x-opencode-session on every request (one stable session id per conversation) and 400-rejects requests without it. When enabled, requests served by opencode.ai (Go/Zen) endpoints automatically carry the current conversation's session id, which the server uses for routing and prompt caching. 100% plugin-side: no dsh source changes, no upgrade friction; the user-agent requirement is already satisfied by dsh's own attribution headers.",
      optModelsTitle: "Model capability",
      optModelsShort: "Sync the model list, capacities and image support",
      optModelsDesc:
        "Merge the endpoint's live model listing over the installed catalog and write it into the dsh llm-pi-ai route: new models become selectable immediately, with no restart. Missing context/output limits are filled from the models.dev registry and from sized siblings; image input is borrowed from any other registered provider that declares the same id multimodal, and a model can be forced vision-capable or text-only here.",
      modelsKeyLabel: "OpenCode API key",
      modelsKeyPlaceholder: "Paste your opencode.ai API key",
      modelsKeyHint: "Empty falls back to the {env} environment variable",
      modelsInfoTitle: "Model list and capabilities",
      modelsInfoDesc:
        "Candidates are the models already configured on this route ({route}); changes apply on save. To adopt new models, use \"fetch available models\" in dsh's own model settings — this plugin wires that action to the live endpoint, and the fetched list is yours to confirm before it is written.",
      modelsVisionLabel: "Force vision models",
      modelsVisionHint: "Search and pick from the route's known models; adding one here removes it from text-only. Applies on save.",
      modelsTextOnlyLabel: "Force text-only models",
      modelsTextOnlyHint: "Search and pick from the route's known models; adding one here removes it from vision. Applies on save.",
      modelsPickSearch: "Search model id or name…",
      modelsPickLoading: "Loading model list…",
      modelsPickFailed: "Could not load the model list: {message}",
      modelsPickUnavailable: "Model-list loader was not injected (plugin wiring bug)",
      modelsPickEmpty: "No matching model",
      modelsPickNoOptions: "This route has no configured model yet — add one in dsh's model settings, or type an id and press Enter.",
      modelsPickAddFree: "Press Enter to add “{id}”",
      modelsPickRemove: "Remove {id}",
      modelsPickCount: "{count} selected",
      modelsSave: "Save",
      slashI18nTitle: "Slash Commands & Skills Translations",
      slashI18nSearchPlaceholder: "Search command or description...",
      slashI18nFilterAll: "All",
      slashI18nFilterUntranslated: "Untranslated",
      slashI18nFilterCommand: "Commands",
      slashI18nFilterSkill: "Skills",
      slashI18nStats: "{total} total · {translated} translated · {untranslated} untranslated",
      slashI18nBatchAi: "Batch AI Translate",
      slashI18nBatchAiOptimize: "Translate & Summarize",
      slashI18nBatchAiLoading: "Translating ({n})...",
      slashI18nBatchAiOptimizeLoading: "Summarizing ({n})...",
      slashI18nSave: "Save Translations",
      slashI18nSavedNotice: "Translations saved and active immediately",
      slashI18nColName: "Name / Type",
      slashI18nColOriginal: "Original Description",
      slashI18nColTranslation: "Chinese Translation (Editable)",
      slashI18nPlaceholderTranslation: "Enter translation or click AI action...",
      slashI18nAiButton: "AI Translate",
      slashI18nAiOptimize: "Summarize",
      slashI18nResetButton: "Reset",
      slashI18nTagBuiltin: "Built-in",
      slashI18nTagCustom: "Custom",
      slashI18nTagLong: "Long",
      slashI18nEmptyFilter: "No matching commands or skills",
      reportTitle: "{count} files edited",
      reportTitleOne: "1 file edited",
      reportMore: "Show {count} more files",
      reportShowFolder: "Show in folder",
      reportOpenAria: "Open {name}",
    };

    /**
     * The active UI locale, normalized to a tag this bundle can format with:
     * "zh" or "en". The locale service is the source of truth; the document
     * language is the fallback for the moment before it boots, and zh is the
     * final default (this plugin's primary audience).
     * @returns {"zh" | "en"}
     */
    function activeLocaleTag() {
      const fromService = localeFace?.getSnapshot?.()?.active;
      const raw = fromService ?? (typeof document === "undefined" ? undefined : document.documentElement?.lang);
      if (raw === undefined || raw === null || String(raw) === "") return "zh";
      return String(raw).toLowerCase().startsWith("zh") ? "zh" : "en";
    }

    /**
     * Translate one toolkit key outside React.
     *
     * The activity view builds its DOM by hand (it re-sorts the host's own
     * sidebar list in place), so it has no `t` prop from the slot system — but
     * that is no reason for it to hardcode Chinese into an English UI. This
     * resolves through the same dictionaries every component uses, with the
     * same "a miss falls back" behaviour.
     * @param {string} key - key in the toolkit dictionary.
     * @param {Record<string, string | number>} [params] - `{name}` substitutions.
     * @returns {string} the localized string.
     */
    function toolkitText(key, params) {
      const tag = activeLocaleTag();
      const dict = tag === "en" ? en : zh;
      let text = dict[key] ?? zh[key] ?? key;
      if (params !== undefined) {
        for (const [name, value] of Object.entries(params)) {
          text = text.split("{" + name + "}").join(String(value));
        }
      }
      return text;
    }

    // ── editLastMessage: edit the last user message and resend in place ──────

    /**
     * Extract the plain text and image references of a user message node's
     * content blocks (mirrors the stock bubble's contentParts read).
     */
    function userTextOf(content) {
      let text = "";
      const images = [];
      const files = [];
      const rest = [];
      for (const block of content || []) {
        if (block?.type === "text" && typeof block.text === "string") text += block.text;
        else if (block?.type === "image" && block.attachment !== undefined) images.push({ attachment: block.attachment });
        else if (block?.type === "file" && block.attachment !== undefined) files.push(block.attachment);
        else rest.push(block);
      }
      return { text, images, files, rest };
    }

    /**
     * One `truncatedLabel` function per `t`. JsonBlock memoizes its rendered
     * string on the identity of this prop, so handing it a fresh arrow on
     * every render would re-run the truncation on every render.
     */
    const truncatedLabels = new WeakMap();
    function truncatedLabelFor(t) {
      let label = truncatedLabels.get(t);
      if (label === undefined) {
        label = (total) => t("msgTruncated", { total });
        truncatedLabels.set(t, label);
      }
      return label;
    }

    /**
     * The last user node's seq in one chat snapshot. The scan runs backwards
     * from the tail, so memoizing per snapshot turns what would be an
     * O(messages) walk per user bubble — O(messages²) per update — into one
     * walk per snapshot.
     */
    const lastUserSeqCache = new WeakMap();
    function lastUserSeq(snapshot) {
      const cached = lastUserSeqCache.get(snapshot);
      if (cached !== undefined) return cached;
      let seq = -1;
      for (let index = snapshot.order.length - 1; index >= 0; index -= 1) {
        const candidate = snapshot.nodes.get(snapshot.order[index]);
        if (candidate?.kind === "user") {
          seq = candidate.data.seq;
          break;
        }
      }
      lastUserSeqCache.set(snapshot, seq);
      return seq;
    }

    /**
     * User-message renderer for the editLastMessage optimization: shadows the
     * stock `user` node renderer (slot priority -1 vs stock 0) and renders the
     * bubble with this package's own chrome (inline styles over the shared CSS
     * variables), adding a pencil edit action to the actions row when this is
     * the LAST user message and the optimization is enabled. Clicking the
     * pencil turns the bubble into an inline editor — no modal.
     *
     * `memo` matches the stock renderer: this shadows EVERY user node, so an
     * unmemoized replacement would re-render every bubble on every store
     * change.
     */
    const ToolkitUserMessageNodeView = memo(function ToolkitUserMessageNodeView(props) {
      const { node, renderMessageImages, openFile, openSkill, t, useChat, sessionId, editLast } = props;
      const data = node.data;
      const enabled = editLast?.isEnabled?.() !== false;
      const { text, images, files, rest } = userTextOf(data.content);
      const refs = data.referenceLabels ?? [];
      const skillNames = data.skillNames ?? [];
      const truncated = truncatedLabelFor(t);
      const showBubble = text !== "" || rest.length > 0;
      // Only the LAST user message offers the edit action.
      const tailSeq = useChat(lastUserSeq);
      // Offering the pencil when the host cannot rewrite guarantees a click
      // that can only fail; require the capability up front.
      const canRewrite = typeof editLast?.sessions?.binding === "function";
      const isTail = enabled && canRewrite && tailSeq === data.seq && text !== "";

      const [editing, setEditing] = useState(false);
      const [draft, setDraft] = useState("");
      const [busy, setBusy] = useState(false);
      const [error, setError] = useState(null);
      const editRef = useRef(null);

      const session = editLast?.sessions?.binding?.(sessionId)?.session;

      const openEdit = () => {
        setDraft(text);
        setError(null);
        setEditing(true);
      };
      const cancelEdit = () => {
        if (busy) return;
        setEditing(false);
        setError(null);
      };
      const save = async () => {
        const next = draft.trim();
        if (next === "" || busy) return;
        setBusy(true);
        setError(null);
        try {
          if (session === undefined || typeof session.rewrite !== "function") {
            setError(t("editUnsupported"));
            return;
          }
          const result = await session.rewrite(data.seq, [{ type: "text", text: next }]);
          if (result.ok) {
            setEditing(false);
          } else {
            setError(result.error?.message ?? t("editError"));
          }
        } catch (cause) {
          setError(cause?.message ?? String(cause));
        } finally {
          setBusy(false);
        }
      };

      // The bubble column shared by the read view and the inline editor.
      const bubbleColumnStyle = {
        display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "8px",
        minWidth: 0, maxWidth: "min(calc(var(--dsh-chat-content-width, 748px) * 0.702), 82%)",
      };
      const bubbleStyle = {
        maxWidth: "100%", background: "var(--dsw-specific-bubble)", borderRadius: "22px",
        padding: "10px 16px", fontSize: "var(--dsh-content-font-size, 14px)",
        lineHeight: "calc(22px + var(--dsh-content-font-delta, 0px))",
        color: "var(--dsw-alias-label-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word",
      };

      const pencil = isTail && !editing ? jsx("button", {
        type: "button",
        "aria-label": t("editOpen"),
        title: t("editOpen"),
        onClick: openEdit,
        style: {
          flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "24px", height: "24px", borderRadius: "6px", padding: 0,
          font: "inherit",
          color: "var(--dsw-alias-label-tertiary, #9ca3af)",
          background: "transparent",
          border: "1px solid transparent",
          cursor: "pointer",
        },
        onMouseEnter: (event) => {
          event.currentTarget.style.color = "var(--dsw-alias-label-primary, #f3f4f6)";
          event.currentTarget.style.background = "rgba(148, 163, 184, 0.18)";
        },
        onMouseLeave: (event) => {
          event.currentTarget.style.color = "var(--dsw-alias-label-tertiary, #9ca3af)";
          event.currentTarget.style.background = "transparent";
        },
        children: jsx(IconEditOutline16, {}),
      }) : null;

      // Inline edit view: the bubble column becomes an editor (same chrome),
      // with a small action row (hint + cancel + regenerate) beneath it.
      if (editing) {
        const lines = Math.min(14, Math.max(3, draft.split("\n").length + 1));
        return jsxs("div", {
          style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" },
          children: [
            jsx("div", {
              style: { ...bubbleColumnStyle, width: "100%" },
              children: jsx("textarea", {
                ref: editRef,
                value: draft,
                disabled: busy,
                spellCheck: false,
                rows: lines,
                autoFocus: true,
                onChange: (event) => { setDraft(event.target.value); },
                onKeyDown: (event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    cancelEdit();
                    return;
                  }
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void save();
                  }
                },
                onFocus: (event) => {
                  const el = event.currentTarget;
                  el.setSelectionRange(el.value.length, el.value.length);
                },
                "aria-label": t("editOpen"),
                style: {
                  ...bubbleStyle,
                  width: "100%", boxSizing: "border-box",
                  font: "inherit", resize: "none", outline: "none",
                  border: "1px solid var(--dsw-alias-state-business-primary, #2563eb)",
                  whiteSpace: "pre-wrap",
                },
              }),
            }),
            jsxs("div", {
              style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", justifyContent: "flex-end" },
              children: [
                error !== null ? jsx("span", {
                  role: "alert",
                  style: { fontSize: "12.5px", lineHeight: 1.5, color: "var(--dsw-alias-state-error-primary, #ef4444)" },
                  children: error,
                }) : null,
                error === null ? jsx("span", {
                  style: { fontSize: "11.5px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
                  children: t("editHintInline"),
                }) : null,
                jsx("button", {
                  type: "button",
                  disabled: busy,
                  onClick: cancelEdit,
                  style: {
                    height: "28px", padding: "0 12px", borderRadius: "14px", fontSize: "12px",
                    lineHeight: "18px", font: "inherit", cursor: busy ? "default" : "pointer",
                    color: "var(--dsw-alias-label-secondary, #d1d5db)",
                    background: "transparent",
                    border: "1px solid var(--dsw-alias-border-l2, #333)",
                  },
                  children: t("editCancel"),
                }),
                jsx("button", {
                  type: "button",
                  disabled: busy || draft.trim() === "",
                  onClick: () => { void save(); },
                  style: {
                    height: "28px", padding: "0 12px", borderRadius: "14px", fontSize: "12px",
                    lineHeight: "18px", font: "inherit", cursor: busy || draft.trim() === "" ? "default" : "pointer",
                    color: "var(--dsw-alias-label-primary-foreground, #fff)",
                    background: "var(--dsw-alias-button-primary-fill, #2563eb)",
                    border: "none",
                    opacity: busy || draft.trim() === "" ? 0.4 : 1,
                  },
                  children: busy ? t("editBusy") : t("editSave"),
                }),
              ],
            }),
          ],
        });
      }

      return jsxs("div", {
        style: { display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "6px" },
        children: [
          jsxs("div", {
            style: bubbleColumnStyle,
            children: [
              renderMessageImages({ images, align: "end" }),
              files.length > 0 ? jsx("div", {
                style: { display: "flex", flexWrap: "wrap", gap: "6px", justifyContent: "flex-end" },
                children: files.map((file, index) => jsxs("span", {
                  key: "file:" + index,
                  title: file.name,
                  style: {
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    maxWidth: "100%", padding: "4px 8px", borderRadius: "8px",
                    fontSize: "12px", color: "var(--dsw-alias-label-secondary, #d1d5db)",
                    background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
                    border: "1px solid var(--dsw-alias-border-l2, #333)",
                  },
                  children: [
                    jsx(FileTypeIcon, { path: file.name }),
                    jsx("span", {
                      style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
                      children: file.name,
                    }),
                    jsx("span", {
                      style: { color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
                      // fileSizeText(undefined) falls through every branch and
                      // renders "NaNGB", which is truthy and survives the join.
                      children: [
                        fileExtension(file.name).toUpperCase().slice(0, 8),
                        typeof file.bytes === "number" ? fileSizeText(file.bytes) : "",
                      ].filter(Boolean).join(" "),
                    }),
                  ],
                }, "file:" + index)),
              }) : null,
              showBubble ? jsx("div", {
                style: bubbleStyle,
                children: [
                  projectUserText(text, refs, skillNames, "skill", { openFile, openSkill }),
                  ...rest.map((block, index) => jsx(JsonBlock, {
                    key: index,
                    label: t("msgExtraBlock"),
                    payload: block,
                    truncatedLabel: truncated,
                  })),
                ],
              }) : null,
              refs.length > 0 ? jsx("div", {
                style: {
                  color: "var(--dsw-alias-label-tertiary)",
                  fontSize: "var(--dsh-content-font-size-secondary, 13px)",
                  lineHeight: "calc(18px + var(--dsh-content-font-delta-secondary, 0px))",
                },
                children: t("msgReferenceSummary", { labels: refs.join(t("msgReferenceSeparator")) }),
              }) : null,
            ],
          }),
          jsx(MessageIconActions, {
            text,
            time: data.time,
            clock: "start",
            t,
            extraActions: pencil,
          }),
        ],
      });
    });

    // ── viewActivity: workspace-header activity toggle (in-sidebar re-sort) ──

    /**
     * Install the viewActivity optimization.
     * 100% non-invasive: attaches a clock toggle button to the sidebar header (.r_*_headerActions),
     * and when active, swaps the native tree body with a cleanly formatted, live-reactive
     * activity view grouped by Priority (Running), Today, Yesterday, Weekday, and Earlier.
     * @param {{ workspaces: any, sessions: any }} services - injected runtime faces.
     * @param {any} scope - bound settings scope, or undefined when unavailable.
     * @returns {() => void} disposer for the effect teardown.
     */
    function installActivityView(services, scope, ctx) {
      if (typeof document === "undefined" || typeof document.querySelector !== "function") {
        return () => {};
      }
      const workspaces = services?.workspaces ?? services?.get?.("workspaces");
      const sessions = services?.sessions ?? services?.get?.("sessions");

      const readStored = (key, fallback) => {
        try { const stored = localStorage.getItem(key); return stored === null ? fallback : stored; }
        catch { return fallback; }
      };
      const writeStored = (key, value) => {
        try { localStorage.setItem(key, value); } catch { /* private mode / no storage */ }
      };

      let active = readStored("dsh:activity-view-active", "false") === "true";
      let disposed = false;
      let treeDirty = true;
      let syncScheduled = false;

      const readValue = () => {
        if (scope === undefined) return undefined;
        const snap = scope.getSnapshot?.();
        return snap?.status === "ready" ? snap.value : undefined;
      };

      const isEnabled = () => {
        const val = readValue();
        return val?.optimizations?.viewActivity !== false;
      };

      const escapeHtml = (str) =>
        String(str ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");

      const pad = (n) => String(n).padStart(2, "0");

      /** Local-midnight start of the calendar day containing a timestamp. */
      const dayStartOf = (ts) => {
        const day = new Date(ts);
        day.setHours(0, 0, 0, 0);
        return day.getTime();
      };

      const formatTime = (ts) => {
        if (!ts) return "";
        const now = Date.now();
        const diffMs = now - ts;
        const diffMin = Math.floor(diffMs / 60000);
        if (diffMin < 1) return toolkitText("activityJustNow");
        if (diffMin < 60) return toolkitText("activityMinutesAgo", { n: diffMin });
        const d = new Date(ts);
        const dayStart = dayStartOf(ts);
        const todayStart = dayStartOf(now);
        const diffHours = Math.floor(diffMs / 3600000);
        if (dayStart === todayStart && diffHours < 24) {
          return toolkitText("activityHoursAgo", { n: diffHours });
        }
        const yesterday = new Date(todayStart);
        yesterday.setDate(yesterday.getDate() - 1);
        if (dayStart === yesterday.getTime()) {
          return toolkitText("activityYesterdayAt", { time: `${pad(d.getHours())}:${pad(d.getMinutes())}` });
        }
        return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      };

      /**
       * Locale-aware weekday name. Intl replaces a hardcoded Chinese table, so
       * an English UI gets "Wednesday" instead of "星期三".
       */
      const weekdayName = (date) => {
        try {
          return new Intl.DateTimeFormat(
            activeLocaleTag() === "zh" ? "zh-CN" : "en-US",
            { weekday: "long" },
          ).format(date);
        } catch {
          return "";
        }
      };

      const renderActivityTree = (container) => {
        if (!container || disposed) return;
        const sSnap = sessions?.list?.getSnapshot?.();
        const wSnap = workspaces?.list?.getSnapshot?.();
        if (!sSnap || !wSnap) return;

        let currentId = sSnap.current;
        if (!currentId) {
          try {
            const raw = localStorage.getItem("dsh.sessions.current");
            if (raw) {
              const parsed = JSON.parse(raw);
              if (parsed?.sessionId) currentId = parsed.sessionId;
            }
          } catch {}
        }
        const archived = new Set(wSnap.archivedSessionIds || []);
        const workspaceBySession = new Map();
        if (Array.isArray(wSnap.items)) {
          for (const ws of wSnap.items) {
            if (Array.isArray(ws.sessionIds)) {
              for (const sid of ws.sessionIds) {
                if (!workspaceBySession.has(sid)) workspaceBySession.set(sid, ws.title || "");
              }
            }
          }
        }

        const labelOf = (s) => {
          const fromWs = workspaceBySession.get(s.id);
          if (fromWs) return fromWs;
          if (s.cwd) {
            return String(s.cwd).replace(/[\\/]+$/, "").split(/[\\/]/).pop() || "";
          }
          return "";
        };

        const running = [];
        const byDay = new Map();
        const ids = sSnap.ids || [];
        const byId = sSnap.byId || {};

        for (const id of ids) {
          const s = byId[id];
          if (!s) continue;
          if (archived.has(s.id)) continue;
          if (s.parentId !== undefined || s.origin === "subagent") continue;
          if (s.blank && s.id !== currentId) continue;

          if (s.running) {
            running.push(s);
          } else {
            const d = new Date(s.updatedAt || 0);
            d.setHours(0, 0, 0, 0);
            const dayKey = d.getTime();
            const list = byDay.get(dayKey);
            if (list) list.push(s);
            else byDay.set(dayKey, [s]);
          }
        }

        const byRecency = (a, b) => (b.updatedAt || 0) - (a.updatedAt || 0);
        running.sort(byRecency);

        const now = Date.now();
        const todayD = new Date(now);
        todayD.setHours(0, 0, 0, 0);
        const todayStart = todayD.getTime();

        const groups = [];
        if (running.length > 0) {
          groups.push({
            key: "priority",
            title: toolkitText("activityPriority"),
            icon: '<svg class="tk-label-spin" width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2.871 13.1286C0.0387669 10.2962 0.0387669 5.70383 2.871 2.87141C5.70341 0.0390029 10.2957 0.0391154 13.1282 2.87141L12.1387 3.86094C9.85292 1.57538 6.1469 1.57596 3.86123 3.86163C1.57573 6.14732 1.57573 9.85269 3.86123 12.1384C6.1469 14.424 9.85292 14.4246 12.1387 12.1391L13.1282 13.1286C10.2957 15.9609 5.70341 15.961 2.871 13.1286Z"/></svg>',
            sessions: running,
          });
        }

        const dayEntries = Array.from(byDay.entries()).sort((a, b) => b[0] - a[0]);
        for (const [dayStart, sList] of dayEntries) {
          sList.sort(byRecency);
          const diffDays = Math.round((todayStart - dayStart) / 86400000);
          let title = toolkitText("activityEarlier");
          if (diffDays <= 0) {
            title = toolkitText("activityToday");
          } else if (diffDays === 1) {
            title = toolkitText("activityYesterday");
          } else if (diffDays < 7) {
            title = weekdayName(new Date(dayStart)) || toolkitText("activityEarlier");
          } else {
            const d = new Date(dayStart);
            title = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
          }
          groups.push({ key: String(dayStart), title, sessions: sList });
        }

        if (groups.length === 0) {
          container.innerHTML = '<div style="padding: 24px 16px; text-align: center; font-size: 13px; color: var(--dsw-alias-label-tertiary, #81858c);">'
            + escapeHtml(toolkitText("activityEmpty")) + '</div>';
          return;
        }

        let html = "";
        for (const grp of groups) {
          html += '<div class="tk-activity-group">';
          if (grp.icon) {
            html += '<div class="tk-activity-label tk-activity-label-with-icon"><span class="tk-activity-label-slot">' + grp.icon + '</span><span>' + escapeHtml(grp.title) + '</span></div>';
          } else {
            html += '<div class="tk-activity-label"><span>' + escapeHtml(grp.title) + '</span></div>';
          }
          for (const s of grp.sessions) {
            const isSelected = s.id === currentId;
            const projectLabel = labelOf(s);
            const title = s.title || s.displayTitle || toolkitText("activityNewSession");
            const timeStr = formatTime(s.updatedAt);
            // The status glyphs carry no text, so the accessible name has to
            // come from aria-label; `title` alone is invisible to assistive
            // technology. `role="img"` keeps the label tied to the glyph.
            const statusIcon = s.running
              ? '<span class="tk-running-spinner" role="img" title="' + escapeHtml(toolkitText("activityRunning")) + '" aria-label="' + escapeHtml(toolkitText("activityRunning")) + '"></span>'
              : (s.completed
                ? '<span class="tk-completed-dot" role="img" title="' + escapeHtml(toolkitText("activityDone")) + '" aria-label="' + escapeHtml(toolkitText("activityDone")) + '"></span>'
                : '<span class="tk-idle-dot" aria-hidden="true"></span>');

            html += '<div class="tk-activity-row' + (isSelected ? ' selected' : '') + '" role="button" tabindex="0" data-session-id="' + escapeHtml(s.id) + '">';
            html += '<div class="tk-activity-row-main">';
            html += '<span class="tk-activity-status-slot">' + statusIcon + '</span>';
            html += '<span class="tk-activity-title" title="' + escapeHtml(title) + '">' + escapeHtml(title) + '</span>';
            html += '<span class="tk-activity-time">' + escapeHtml(timeStr) + '</span>';
            html += '</div>';

            if (projectLabel) {
              html += '<div class="tk-activity-project-line">';
              html += '<svg class="tk-folder-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 2.5a.25.25 0 00-.25.25v10.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25V5.75a.25.25 0 00-.25-.25H7.586a1.25 1.25 0 01-.884-.366L5.586 4H1.75zM0 2.75C0 1.784.784 1 1.75 1h3.836c.464 0 .91.184 1.237.512L8.237 3H14.25c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 15H1.75A1.75 1.75 0 010 13.25V2.75z"/></svg>';
              html += '<span class="tk-activity-project-label" title="' + escapeHtml(projectLabel) + '">' + escapeHtml(projectLabel) + '</span>';
              html += '</div>';
            }

            html += '</div>';
          }
          html += '</div>';
        }

        container.innerHTML = html;

        const rows = container.querySelectorAll(".tk-activity-row");
        rows.forEach((row) => {
          const open = (e) => {
            e.preventDefault();
            e.stopPropagation();
            const sid = row.getAttribute("data-session-id");
            if (!sid) return;

            // Immediate visual selection
            container.querySelectorAll(".tk-activity-row.selected").forEach((r) => r.classList.remove("selected"));
            row.classList.add("selected");

            // 1. Try injected uiWorkspace service
            let nav = undefined;
            try {
              nav = services?.uiWorkspace ?? services?.get?.("uiWorkspace") ?? ctx?.uiWorkspace ?? ctx?.get?.("uiWorkspace");
            } catch {}

            // 2. Fallback: retrieve onOpen from React fiber on native sidebar session rows
            if (!nav?.openSession) {
              try {
                const nativeRow = document.querySelector('[class*="_sessionRow"]');
                if (nativeRow) {
                  const fiberKey = Object.keys(nativeRow).find((k) => k.startsWith("__reactFiber"));
                  let cur = fiberKey ? nativeRow[fiberKey] : null;
                  while (cur) {
                    if (typeof cur.memoizedProps?.onOpen === "function") {
                      nav = { openSession: cur.memoizedProps.onOpen };
                      break;
                    }
                    cur = cur.return;
                  }
                }
              } catch {}
            }

            if (nav?.openSession) {
              nav.openSession(sid);
            } else if (sessions?.open) {
              sessions.open(sid);
            }
          };
          row.onclick = open;
          // role="button" + tabindex alone would advertise a control that the
          // keyboard cannot operate; Enter and Space are what a button owes.
          row.onkeydown = (e) => {
            if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") open(e);
          };
        });
      };

      /**
       * The sidebar region that owns BOTH the header actions and the
       * conversation list. Looking each up document-wide used to be able to
       * put the toggle in one panel's header and the tree in another panel's
       * list once a second listing existed (a drawer, a secondary sidebar).
       * Falls back to the document when the host's class names change.
       */
      const sidebarScope = () => {
        let node = document.querySelector('[class*="_listArea"]')?.parentElement ?? null;
        for (let depth = 0; node !== null && node !== document.body && depth < 4; depth += 1) {
          if (node.querySelector('[class*="_headerActions"]') !== null) return node;
          node = node.parentElement;
        }
        return document;
      };

      /**
       * Inline `display` values this installer overrode. Restoring with `""`
       * would discard whatever inline value the host (or another plugin) had
       * put there, so the previous value is captured on first hide and put
       * back verbatim.
       */
      const hiddenDisplay = new WeakMap();
      const hideElement = (el) => {
        if (!hiddenDisplay.has(el)) hiddenDisplay.set(el, el.style.display);
        el.style.display = "none";
      };
      const restoreElement = (el) => {
        if (!hiddenDisplay.has(el)) return;
        const previous = hiddenDisplay.get(el);
        hiddenDisplay.delete(el);
        el.style.display = previous;
      };

      const syncView = () => {
        if (disposed) return;
        const enabled = isEnabled();
        const root = sidebarScope();
        const headerActions = root.querySelector('[class*="_headerActions"]');
        const listArea = root.querySelector('[class*="_listArea"]');

        let btn = document.getElementById("tk-activity-btn");
        if (!enabled) {
          // Leaving the persisted flag set meant re-enabling the optimization
          // later silently snapped the sidebar back into activity mode instead
          // of the grouping the user was last looking at.
          if (active) {
            active = false;
            writeStored("dsh:activity-view-active", "false");
          }
          if (btn) btn.style.display = "none";
          const tree = document.getElementById("tk-activity-tree");
          if (tree) tree.style.display = "none";
          if (listArea) {
            const nativeTrees = listArea.querySelectorAll('[class*="_treeBody"]:not(#tk-activity-tree)');
            nativeTrees.forEach(restoreElement);
          }
          return;
        }

        if (headerActions) {
          if (!btn || btn.parentElement !== headerActions) {
            if (!btn) {
              btn = document.createElement("button");
              btn.id = "tk-activity-btn";
              btn.className = "tk-activity-btn" + (active ? " active" : "");
              btn.type = "button";
              btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.3"></circle><path d="M8 4.5V8l2.5 1.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"></path></svg>';
              btn.onclick = (e) => {
                e.preventDefault();
                e.stopPropagation();
                active = !active;
                writeStored("dsh:activity-view-active", String(active));
                treeDirty = true;
                syncView();
              };
            }
            headerActions.insertBefore(btn, headerActions.firstChild);
          }
          btn.style.display = "inline-flex";
          btn.className = "tk-activity-btn" + (active ? " active" : "");
          btn.title = active ? toolkitText("activityBtnActive") : toolkitText("activityBtnInactive");
          btn.setAttribute("aria-label", active ? toolkitText("activityBtnActive") : toolkitText("activityOpen"));
        }

        if (listArea) {
          let tree = document.getElementById("tk-activity-tree");
          const nativeTrees = listArea.querySelectorAll('[class*="_treeBody"]:not(#tk-activity-tree)');

          const searchInput = document.querySelector('input[type="search"], [class*="_searchInput"], [class*="_searchBox"] input');
          const isSearching = searchInput && searchInput.value && searchInput.value.trim() !== "";

          if (active && !isSearching) {
            nativeTrees.forEach(hideElement);
            if (!tree || tree.parentElement !== listArea) {
              if (!tree) {
                tree = document.createElement("div");
                tree.id = "tk-activity-tree";
                tree.className = "tk-activity-tree";
              }
              listArea.appendChild(tree);
              treeDirty = true;
            }
            tree.style.display = "flex";
            if (treeDirty) {
              renderActivityTree(tree);
              treeDirty = false;
            }
          } else {
            if (tree) tree.style.display = "none";
            nativeTrees.forEach(restoreElement);
          }
        }
      };

      const scheduleSync = () => {
        if (syncScheduled || disposed) return;
        syncScheduled = true;
        requestAnimationFrame(() => {
          syncScheduled = false;
          syncView();
        });
      };

      const stop1 = sessions?.list?.subscribe?.(() => {
        treeDirty = true;
        scheduleSync();
      });
      const stop2 = workspaces?.list?.subscribe?.(() => {
        treeDirty = true;
        scheduleSync();
      });
      const stop3 = scope?.watch?.(() => {
        scheduleSync();
      });

      // The observer must notice our nodes being evicted by a sidebar
      // re-render, but its callback runs on EVERY DOM mutation in the app. Keep
      // it to two O(1) id lookups; the expensive `[class*="_listArea"]` query
      // belongs in syncView, which is already rAF-throttled.
      const observer = new MutationObserver(() => {
        if (document.getElementById("tk-activity-btn") === null) {
          scheduleSync();
          return;
        }
        if (active && document.getElementById("tk-activity-tree") === null) {
          scheduleSync();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      scheduleSync();

      return () => {
        disposed = true;
        observer.disconnect();
        stop1?.();
        stop2?.();
        stop3?.();
        const btn = document.getElementById("tk-activity-btn");
        if (btn) btn.remove();
        const tree = document.getElementById("tk-activity-tree");
        if (tree) tree.remove();
        const listArea = sidebarScope().querySelector('[class*="_listArea"]');
        if (listArea) {
          const nativeTrees = listArea.querySelectorAll('[class*="_treeBody"]');
          nativeTrees.forEach(restoreElement);
        }
      };
    }

    // ── slashI18n: Chinese descriptions for the '/' menu ──────────────────────

    /**
     * Exact-match en→zh dictionary for the '/' menu's host-provided strings.
     * Covers every built-in host command's description (verbatim from the dsh
     * sources), the input hints ui-conversation's own `hint.*` keys don't
     * cover, and the built-in skills' catalog descriptions (SKILL.md
     * frontmatter, verbatim). `name` fields are NEVER translated — fuzzy
     * matching, the lexicon, and claim adjudication all read them. A dictionary
     * miss falls back to the original string, so a dsh update that rewords a
     * description degrades to English instead of breaking the menu.
     */
    const SLASH_ZH = {
      // Built-in '/' command descriptions (host catalog).
      "Compact older conversation history": "压缩更早的对话历史",
      "record feedback about this session": "记录对本会话的反馈",
      "set or view the goal for a long-running task": "设置或查看长期任务的目标",
      "Switch the permission preset (sandbox mode + approval policy)":
        "切换权限预设（沙箱模式 + 审批策略）",
      "Enter or leave plan mode": "进入或退出计划模式",
      "Download this Session log as a ZIP archive": "将本会话日志下载为 ZIP 压缩包",
      // Command input hints without a ui-conversation `hint.*` key already.
      "<text>": "<反馈内容>",
      "<preset>": "<预设名>",
      // Built-in skill catalog descriptions (SKILL.md frontmatter, verbatim).
      "How this machine's Hindsight coding-agent memory works — the plugin behind the 🧠 banner. Use when the user says \"store/remember this in hindsight\", asks what the memory/knowledge pages are, wants to configure per-repo memory (disable, rename banks, git depth), or something memory-related looks broken.":
        "本机 Hindsight 编码代理记忆的工作方式（🧠 横幅背后的插件）。当用户说「把…存进 hindsight」、询问记忆/知识页是什么、想配置每仓库记忆（禁用、重命名 bank、git 深度），或记忆相关功能疑似故障时使用。",
      "Manage DSH Taskboard / DeepSeek Harness work with taskctl. Use for taskboard issue IDs, status sync, comments, or project task tracking.":
        "用 taskctl 管理 DSH Taskboard / DeepSeek Harness 的任务。适用于任务板 issue 编号、状态同步、评论或项目任务跟踪。",
    };

    /** Live in-memory custom and AI translations. */
    let customSlashZh = {};

    /** Discovered commands and skills registry: map from description to item metadata. */
    const discoveredRegistry = new Map();

    function recordDiscoveredItem(item) {
      if (!item || !item.description) return;
      const desc = item.description;
      const existing = discoveredRegistry.get(desc);
      if (existing) {
        discoveredRegistry.set(desc, { ...existing, ...item });
      } else {
        discoveredRegistry.set(desc, item);
      }
    }

    // Pre-populate with known default catalog items:
    recordDiscoveredItem({ name: "/compact", description: "Compact older conversation history", type: "command" });
    recordDiscoveredItem({ name: "/feedback", description: "record feedback about this session", type: "command", hint: "<text>" });
    recordDiscoveredItem({ name: "/feedback [hint]", description: "<text>", type: "hint" });
    recordDiscoveredItem({ name: "/goal", description: "set or view the goal for a long-running task", type: "command" });
    recordDiscoveredItem({ name: "/permission", description: "Switch the permission preset (sandbox mode + approval policy)", type: "command", hint: "<preset>" });
    recordDiscoveredItem({ name: "/permission [hint]", description: "<preset>", type: "hint" });
    recordDiscoveredItem({ name: "/plan", description: "Enter or leave plan mode", type: "command" });
    recordDiscoveredItem({ name: "/download-logs", description: "Download this Session log as a ZIP archive", type: "command" });
    recordDiscoveredItem({
      name: "hindsight-coding-agent",
      description: "How this machine's Hindsight coding-agent memory works — the plugin behind the 🧠 banner. Use when the user says \"store/remember this in hindsight\", asks what the memory/knowledge pages are, wants to configure per-repo memory (disable, rename banks, git depth), or something memory-related looks broken.",
      type: "skill",
    });
    recordDiscoveredItem({
      name: "manage-taskboard",
      description: "Manage DSH Taskboard / DeepSeek Harness work with taskctl. Use for taskboard issue IDs, status sync, comments, or project task tracking.",
      type: "skill",
    });

    /** Load saved custom translations from backend. */
    async function loadCustomSlashTranslations() {
      if (typeof window === "undefined" || !window.location) return;
      try {
        const res = await fetch("/api/toolkit/slash-translations");
        if (res.ok) {
          const data = await res.json();
          if (data && data.ok) {
            if (data.translations && typeof data.translations === "object") {
              customSlashZh = { ...customSlashZh, ...data.translations };
            }
            if (Array.isArray(data.discovered)) {
              for (const item of data.discovered) {
                recordDiscoveredItem(item);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[toolkit] failed to load custom slash translations:", err);
      }
    }
    void loadCustomSlashTranslations();

    let globalRemoteServices = undefined;

    async function probeRemoteCatalog() {
      if (globalRemoteServices?.["remote.commands"]) {
        try {
          const res = await globalRemoteServices["remote.commands"].list();
          if (res?.ok && Array.isArray(res.value)) {
            for (const cmd of res.value) {
              if (cmd?.description) {
                recordDiscoveredItem({
                  name: cmd.name || "",
                  description: cmd.description,
                  type: "command",
                  hint: cmd.input?.hint,
                });
              }
              if (cmd?.input?.hint) {
                recordDiscoveredItem({
                  name: (cmd.name || "") + " [hint]",
                  description: cmd.input.hint,
                  type: "hint",
                });
              }
            }
          }
        } catch {}
      }
      if (globalRemoteServices?.["remote.skills"]) {
        try {
          const res = await globalRemoteServices["remote.skills"].list();
          const skillsList = res?.ok ? (Array.isArray(res.value) ? res.value : res.value?.skills) : undefined;
          if (Array.isArray(skillsList)) {
            for (const sk of skillsList) {
              if (sk?.description) {
                recordDiscoveredItem({
                  name: sk.name || "",
                  description: sk.description,
                  type: "skill",
                });
              }
            }
          }
        } catch {}
      }
    }

    function getDiscoveredItemsList() {
      return Array.from(discoveredRegistry.values());
    }

    /** Symbol flags marking an already-wrapped namespace service method. */
    const SLASH_I18N_FLAG = Symbol.for("dsh-plugin-toolkit.slashI18n.wrapped");
    /** cordis exposes the raw service behind a traceable proxy under this symbol. */
    const CORDIS_ORIGINAL = Symbol.for("cordis.original");
    /**
     * The locale service face, captured in apply (undefined before that).
     * Shared by everything that needs the active language outside React:
     * slashI18n's gate and the activity view's strings.
     */
    let localeFace = undefined;

    /**
     * Live settings scope for the slash rewriters, refreshed on every apply.
     * The rewriters read it at call time so a remount rebinds them.
     */
    let slashScope;

    /** Undo records for the namespace wraps, so teardown restores the host. */
    const slashWraps = [];

    /**
     * Read the slashI18n gate: settings switch on AND the UI language is
     * Chinese. Re-evaluated per RPC result, so the settings toggle applies to
     * the very next menu opening without a reload. The locale snapshot is
     * unreadable only before the locale service boots — translate then (this
     * optimization exists for the Chinese UI).
     * @param {any} scope - bound settings scope, or undefined when unavailable.
     * @returns {boolean} whether responses should be translated.
     */
    function slashI18nActive(scope) {
      const snap = scope?.getSnapshot?.();
      if (snap?.status === "ready" && snap.value?.optimizations?.slashI18n === false) return false;
      const active = localeFace?.getSnapshot?.()?.active;
      return active === undefined || String(active).toLowerCase().startsWith("zh");
    }

    /**
     * Translate one host-provided menu string through the exact-match
     * dictionary. Anything absent (including non-strings) passes through.
     * @param {any} text - the host string (description or input hint).
     * @param {any} scope - settings scope for the gate.
     * @returns {any} the translated string, or the input untouched.
     */
    function slashZhText(text, scope) {
      if (typeof text !== "string" || !slashI18nActive(scope)) return text;
      if (Object.prototype.hasOwnProperty.call(customSlashZh, text)) {
        const val = customSlashZh[text];
        if (typeof val === "string" && val.trim() !== "") return val;
      }
      return Object.prototype.hasOwnProperty.call(SLASH_ZH, text) ? SLASH_ZH[text] : text;
    }

    /**
     * Rewrite a `commands.list` RemoteResult: descriptions and input hints
     * only; names, input.images and every other field ride untouched. Builds
     * new row objects so the caller-owned cache never aliases the wire result.
     * @param {any} result - the RemoteResult from the namespace call.
     * @param {any} scope - settings scope for the gate.
     * @returns {any} the result with translated display strings.
     */
    function rewriteCommandsResult(result, scope) {
      if (result === null || typeof result !== "object" || result.ok !== true) return result;
      const value = result.value;
      if (!Array.isArray(value)) return result;
      const rows = value.map((command) => {
        if (command === null || typeof command !== "object") return command;
        if (command.description) {
          recordDiscoveredItem({
            name: command.name || "",
            description: command.description,
            type: "command",
            hint: command.input?.hint,
          });
        }
        if (command.input?.hint) {
          recordDiscoveredItem({
            name: (command.name || "") + " [hint]",
            description: command.input.hint,
            type: "hint",
          });
        }
        const next = { ...command, description: slashZhText(command.description, scope) };
        if (next.input !== undefined && next.input !== null && typeof next.input === "object") {
          next.input = { ...next.input, hint: slashZhText(next.input.hint, scope) };
        }
        return next;
      });
      return { ...result, value: rows };
    }

    /**
     * Rewrite a `skills.list` RemoteResult: each SkillEntry's description
     * only; `name` / `whenToUse` / `modelInvocable` ride untouched.
     * @param {any} result - the RemoteResult from the namespace call.
     * @param {any} scope - settings scope for the gate.
     * @returns {any} the result with translated display strings.
     */
    function rewriteSkillsResult(result, scope) {
      if (result === null || typeof result !== "object" || result.ok !== true) return result;
      const value = result.value;
      if (value === null || typeof value !== "object" || !Array.isArray(value.skills)) return result;
      const skills = value.skills.map((skill) => {
        if (skill !== null && typeof skill === "object") {
          if (skill.description) {
            recordDiscoveredItem({
              name: skill.name || "",
              description: skill.description,
              type: "skill",
            });
          }
          return { ...skill, description: slashZhText(skill.description, scope) };
        }
        return skill;
      });
      return { ...result, value: { ...value, skills } };
    }

    /**
     * Wrap one RemoteNamespaceService method with an async response rewriter.
     *
     * The stock method is a getter accessor returning a fresh closure per
     * access (reading the method table at call time, so remounts keep
     * working). We re-define the property with our own getter that delegates
     * to the ORIGINAL accessor with the same `this` — preserving the
     * caller-context shadowing the traceable proxy layer supplies (scoped
     * session identity rides it) — and post-process only the resolved
     * RemoteResult. Rejections and every non-promise outcome pass through.
     * @param {any} service - the namespace service (possibly traceable proxy).
     * @param {string} method - the method name to wrap ("list").
     * @param {(result: any, scope: any) => any} rewrite - result rewriter.
     * @returns {boolean} whether the wrap took effect.
     */
    function wrapNamespaceMethod(service, method, rewrite) {
      const target = typeof service === "object" && service !== null
        ? (service[CORDIS_ORIGINAL] ?? service)
        : undefined;
      if (target === undefined || typeof target !== "object") return false;
      const flag = target[SLASH_I18N_FLAG] ?? new Set();
      if (flag.has(method)) return true;
      const desc = Object.getOwnPropertyDescriptor(target, method);
      // Only the stock accessor shape (getter, no setter) is safe to re-define.
      if (!desc || typeof desc.get !== "function" || desc.set !== undefined) return false;
      const originalGet = desc.get;
      try {
        Object.defineProperty(target, method, {
          configurable: true,
          enumerable: true,
          get: function () {
            const original = originalGet.call(this);
            return (...args) => {
              const outcome = original(...args);
              if (outcome !== null && typeof outcome.then === "function") {
                return outcome.then((result) => {
                  try {
                    // The scope is read at CALL time, not captured here: a
                    // remount rebinds it, and freezing the first one made the
                    // settings toggle stop taking effect.
                    return rewrite(result, slashScope);
                  } catch (error) {
                    console.warn("[toolkit] slashI18n rewrite failed:", error);
                    return result;
                  }
                });
              }
              return outcome;
            };
          },
        });
      } catch (error) {
        console.warn(`[toolkit] slashI18n cannot wrap remote method "${method}":`, error);
        return false;
      }
      flag.add(method);
      target[SLASH_I18N_FLAG] = flag;
      slashWraps.push({ target, method, descriptor: desc });
      return true;
    }

    /**
     * Undo every namespace wrap. The patch used to be permanent — torn down
     * plugin, patched service left behind — which is why a later install of a
     * different toolkit version found the marker and silently no-oped.
     */
    function unwrapNamespaceMethods() {
      for (const record of slashWraps.splice(0)) {
        try {
          Object.defineProperty(record.target, record.method, record.descriptor);
          const flag = record.target[SLASH_I18N_FLAG];
          if (flag instanceof Set) {
            flag.delete(record.method);
            if (flag.size === 0) delete record.target[SLASH_I18N_FLAG];
          }
        } catch (error) {
          console.warn(`[toolkit] slashI18n could not restore remote method "${record.method}":`, error);
        }
      }
    }

    /**
     * Install the slashI18n optimization: wrap `remote.commands.list` and
     * `remote.skills.list` so the '/' menu shows Chinese descriptions. Both
     * namespaces arrive through ctx.inject, so an older host without them
     * simply never activates this optimization (the toolkit keeps loading).
     * @param {{ "remote.commands": any, "remote.skills": any }} services - namespace services.
     * @param {any} scope - bound settings scope, or undefined when unavailable.
     * @returns {() => void} disposer restoring the host's own methods.
     */
    function installSlashI18n(services, scope) {
      // Refresh the live binding first: this runs on every apply, and the
      // wrappers installed by an earlier apply must follow the new scope.
      slashScope = scope;
      globalRemoteServices = services;
      void probeRemoteCatalog();
      const commands = wrapNamespaceMethod(services["remote.commands"], "list", rewriteCommandsResult);
      const skills = wrapNamespaceMethod(services["remote.skills"], "list", rewriteSkillsResult);
      if (commands || skills) {
        console.info(`[toolkit] slashI18n installed (commands: ${commands}, skills: ${skills})`);
      } else {
        console.warn("[toolkit] slashI18n: no compatible remote namespace method found");
      }
      return unwrapNamespaceMethods;
    }

    // ── changeReport: codex-style per-turn change report ─────────────────────

    /**
     * Chain priority for the turn-tail slot. ui-deliverables registers the
     * same chain at default priority 0 with an overlapping trigger (any
     * successful file mutation this turn), and a chain renders its FIRST
     * accepting selector. The change report is a superset of that produced-
     * files tail — same openable chips plus line counts and a review diff —
     * so it must try FIRST; whenever it declines (no mutations, or the
     * toggle is off) the stock tail renders exactly as before.
     */
    const REPORT_TAIL_PRIORITY = -10;
    /** Turn-data key this optimization publishes its hunks under. */
    const REPORT_DATA_KEY = "changeReport";
    /** File rows shown before the show-more expander. */
    const REPORT_SHOWN_LIMIT = 4;
    /** Faces captured in apply (factory-level, like localeFace). */
    const changeReportRefs = { scope: undefined, remote: undefined, revealPath: undefined, workspacePathOpen: makeTinyStore(undefined) };
    /** Whether the workspace-path-open capability was probed (per connection). */
    let changeReportCapabilityRequested = false;

    /**
     * Minimal HostObservable (getSnapshot/subscribe/set) backing the
     * workspace-path-open capability probe; the slots framework turns the
     * hooks entry into the component's useWorkspacePathOpen selector hook.
     */
    function makeTinyStore(initial) {
      let value = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => value,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        set: (next) => {
          if (value === next) return;
          value = next;
          for (const fn of [...listeners]) { try { fn(); } catch { /* listener errors stay local */ } }
        },
      };
    }
    /** Whether the turn-data definition has been registered (apply may re-run). */
    let changeReportDefinitionRegistered = false;

    /** Non-blank path exactly as the tool received it. */
    function reportPathValue(value) {
      return typeof value === "string" && value.trim() !== "" ? value : null;
    }

    /**
     * Extract one file-mutation hunk from a tool call's arguments. Accepts the
     * raw JSON string of a root tool/call event AND the already-parsed object
     * of a tool/code-dispatch event. Mirrors ui-deliverables' mutationPath
     * acceptance exactly (write, edit, mutating str_replace_editor) but keeps
     * the before/after texts too — the line counts and the review diff both
     * derive from them.
     */
    function reportMutationFromArgs(name, rawArgs) {
      let args;
      if (typeof rawArgs === "string") {
        try { args = JSON.parse(rawArgs); } catch { return null; }
      } else if (rawArgs !== null && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        args = rawArgs;
      } else {
        return null;
      }
      if (args === null || typeof args !== "object" || Array.isArray(args)) return null;
      if (name === "write") {
        const path = reportPathValue(args.file_path);
        return typeof args.content === "string" && path !== null
          ? { path, oldText: null, newText: args.content }
          : null;
      }
      if (name === "edit") {
        const path = reportPathValue(args.file_path);
        if (path === null) return null;
        if (typeof args.old_string !== "string" || args.old_string === "") return null;
        if (typeof args.new_string !== "string" || args.old_string === args.new_string) return null;
        if (args.replace_all !== undefined && typeof args.replace_all !== "boolean") return null;
        return { path, oldText: args.old_string, newText: args.new_string };
      }
      if (name === "str_replace_editor") {
        const path = reportPathValue(args.path);
        if (path === null) return null;
        if (args.command === "create") {
          return typeof args.file_text === "string" ? { path, oldText: null, newText: args.file_text } : null;
        }
        if (args.command === "str_replace") {
          if (typeof args.old_str !== "string" || args.old_str === "") return null;
          if (args.new_str !== undefined && typeof args.new_str !== "string") return null;
          return { path, oldText: args.old_str, newText: typeof args.new_str === "string" ? args.new_str : "" };
        }
        if (args.command === "insert") {
          if (typeof args.insert_line !== "number" || !Number.isInteger(args.insert_line) || args.insert_line < 0) return null;
          if (typeof args.new_str !== "string") return null;
          return { path, oldText: null, newText: args.new_str };
        }
        return null;
      }
      return null;
    }

    /**
     * Root tool-call id → turn number, recorded as root tool/call events fold.
     * Code-dispatch events only carry rootCallId, so this is how their
     * mutations join the right turn's fold. Bounded (see
     * {@link rememberRootCallTurn}) because it is page-scoped: every root call
     * in every conversation opened during one page load used to accumulate
     * here forever.
     */
    const reportRootCallTurns = new Map();
    /** Ceiling on that map; only recently-issued calls can still settle. */
    const REPORT_ROOT_CALL_LIMIT = 500;

    /**
     * Record one root call's turn, evicting the oldest entries past the cap.
     * Map iteration is insertion-ordered, so the front is the oldest call; a
     * dispatch for an evicted id simply drops out of the report, which can only
     * happen for a call that settled long before.
     */
    function rememberRootCallTurn(callId, turn) {
      reportRootCallTurns.set(callId, turn);
      while (reportRootCallTurns.size > REPORT_ROOT_CALL_LIMIT) {
        const oldest = reportRootCallTurns.keys().next();
        if (oldest.done === true) break;
        reportRootCallTurns.delete(oldest.value);
      }
    }

    /**
     * Conversation turn-data definition: accumulates one hunk per successful
     * file-mutation call this turn and publishes it to the turn data store for
     * the selector. Two wire-event grammars feed it: root tool/call +
     * tool/result events (a direct agent tool call), and tool/code-dispatch
     * events (run_code's nested sub-calls, which carry rootCallId instead of
     * turn and never produce root tool/call events — a root run_code turn's
     * write/edit mutations ONLY exist as dispatches). Dispatch events route to
     * their turn through the rootCallId → turn map recorded from tool/call
     * events. Hunks carry before/after so the review modal can render real
     * diffs. Registered once per page load.
     */
    const changeReportDefinition = {
      kind: "changeReport",
      match: (event) => {
        if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
        if (event.type === "tool/call") return { id: String(event.data.turn), role: "update" };
        if (event.type === "tool/code-dispatch") {
          // Route a nested sub-call back to its root run_code call's turn.
          const turn = reportRootCallTurns.get(String(event.data?.rootCallId));
          return typeof turn === "number" ? { id: String(turn), role: "update" } : null;
        }
        if (event.type === "tool/result" && typeof event.data?.turn === "number") {
          return { id: String(event.data.turn), role: "update" };
        }
        return null;
      },
      start: (_context, match) => ({ turn: match.event.data.turn, calls: new Map(), hunks: [] }),
      update: (context, match) => {
        const state = context.state;
        if (match.event.type === "tool/call") {
          // Remember the turn of every root call so its code-dispatch children
          // can join this fold (set here, where the routed turn is known).
          const callId = String(match.event.data.callId);
          if (callId !== "") rememberRootCallTurn(callId, state.turn);
          // `calls` is private fold state (only `hunks` is published), so mutate
          // it in place instead of copying the whole map on every call (O(n²)).
          state.calls.set(
            callId,
            reportMutationFromArgs(match.event.data.name, match.event.data.arguments),
          );
          return state;
        }
        if (match.event.type === "tool/code-dispatch") {
          // A settled nested sub-call: the event itself carries name,
          // arguments and isError (no separate result event follows).
          if (match.event.data?.isError === true) return state;
          const mutation = reportMutationFromArgs(match.event.data?.name, match.event.data?.arguments);
          if (mutation === null) return state;
          return {
            ...state,
            hunks: [...state.hunks, { seq: match.event.seq, path: mutation.path, oldText: mutation.oldText, newText: mutation.newText }],
          };
        }
        if (match.event.type !== "tool/result") return state;
        const result = match.event.data.message?.content?.[0];
        if (result === undefined || result.isError === true) return state;
        const callId = String(match.event.data.message?.source?.callId ?? "");
        const mutation = state.calls.get(callId);
        if (mutation === undefined || mutation === null) return state;
        return {
          ...state,
          hunks: [...state.hunks, { seq: match.event.seq, path: mutation.path, oldText: mutation.oldText, newText: mutation.newText }],
        };
      },
      buildLocationData: (context, scope, previous) => {
        if (scope !== "turn" || context.state === undefined) return null;
        if (
          previous?.kind === "turn"
          && previous.turn === context.state.turn
          && previous.key === REPORT_DATA_KEY
          && previous.value.hunks === context.state.hunks
        ) return previous;
        return {
          kind: "turn",
          turn: context.state.turn,
          key: REPORT_DATA_KEY,
          value: { hunks: context.state.hunks },
        };
      },
    };

    /**
     * Settings gate for the chain selector. Read per render; when off the
     * selector declines, so the stock produced-files tail renders unchanged.
     */
    function changeReportEnabled() {
      const snap = changeReportRefs.scope?.getSnapshot?.();
      return snap?.status === "ready" ? snap.value?.optimizations?.changeReport !== false : true;
    }

    /** Per-hunk diff totals; a hunk object is immutable once folded. */
    const reportHunkTotals = new WeakMap();
    /**
     * Shared empty array for turns without hunks. Allocating a fresh `[]` per
     * call made the identity check below miss every time, so the selector cache
     * never hit on the common (no-mutation) path and stored a throwaway entry.
     */
    const EMPTY_HUNKS = [];
    /** Last selector answer: repeated evaluations with the same inputs are free. */
    let selectTurnChangesCache = { hunks: null, seq: null, result: null, valid: false };

    /**
     * Chain selector: accept a turn whose settled mutations exist, returning
     * the aggregated per-file model for the card. Reads only the owner props
     * and the turn data store, like ui-deliverables' own selector. Line
     * counts reuse the primitives' diffTotals, so the header numbers and the
     * per-file rows always describe the same hunks.
     */
    function selectTurnChanges(owner) {
      if (!changeReportEnabled()) return null;
      const stored = owner.turn?.data?.get?.(REPORT_DATA_KEY);
      const hunks = Array.isArray(stored?.hunks) && stored.hunks.length > 0 ? stored.hunks : EMPTY_HUNKS;
      if (selectTurnChangesCache.valid
        && selectTurnChangesCache.hunks === hunks
        && selectTurnChangesCache.seq === owner.seq) {
        return selectTurnChangesCache.result;
      }
      const settled = hunks.filter((hunk) => hunk.seq <= owner.seq);
      if (settled.length === 0) {
        selectTurnChangesCache = { hunks, seq: owner.seq, result: null, valid: true };
        return null;
      }
      const files = [];
      const byPath = new Map();
      let added = 0;
      let removed = 0;
      for (const hunk of settled) {
        let file = byPath.get(hunk.path);
        if (file === undefined) {
          file = { path: hunk.path, added: 0, removed: 0, hunks: [] };
          byPath.set(hunk.path, file);
          files.push(file);
        }
        let part = reportHunkTotals.get(hunk);
        if (part === undefined) {
          part = diffTotals([{ path: hunk.path, oldText: hunk.oldText, newText: hunk.newText }]);
          reportHunkTotals.set(hunk, part);
        }
        file.added += part.added;
        file.removed += part.removed;
        file.hunks.push(hunk);
        added += part.added;
        removed += part.removed;
      }
      const result = { files, added, removed };
      selectTurnChangesCache = { hunks, seq: owner.seq, result, valid: true };
      return result;
    }

    /**
     * Codex-style change report card for one completed turn: aggregate
     * header, per-file rows with +/- counts (click opens the file), an
     * expander for long lists, and the folder-open capability the stock
     * produced-files tail carried.
     */
    function TurnChangeReport(props) {
      const { matched, openFile, isLoopback, ensureWorkspacePathOpen, revealPath, useWorkspacePathOpen, t } = props;
      // Both faces arrive as functions because the slot's inject result is
      // memoized: reading the value at registration time froze it (see the
      // turnTail registration in apply).
      useEffect(() => { ensureWorkspacePathOpen?.(); }, [ensureWorkspacePathOpen]);
      const hostCanOpenPath = useWorkspacePathOpen?.((available) => available === true);
      const canOpenPath = isLoopback?.() === true && hostCanOpenPath === true;
      const { files, added, removed } = matched;
      const [expanded, setExpanded] = useState(false);
      const shown = expanded ? files : files.slice(0, REPORT_SHOWN_LIMIT);
      const hidden = files.length - shown.length;
      const countLabel = files.length === 1
        ? t("reportTitleOne")
        : t("reportTitle", { count: String(files.length) });
      // CodeBlock/DiffBlock container recipe: markdown-code-block background,
      // 12px radius, banner row on the banner background, mono body at the
      // diff's 22px line height. The banner and the body share the same 14px
      // horizontal padding, so the header stat and the per-file stats right-
      // align on one edge; digits are code-font success/error colored.
      const stat = (a, r) => jsx("span", {
        className: "tk-report-num",
        children: [
          jsx("span", { style: { color: "var(--dsw-alias-state-success-primary, #16a34a)" }, children: "+" + String(a) }),
          jsx("span", { style: { marginLeft: "6px", color: "var(--dsw-alias-state-error-primary, #ef4444)" }, children: "-" + String(r) }),
        ],
      });
      return jsxs("div", {
        className: "tk-report-block",
        style: { marginTop: "6px" },
        children: [
          jsxs("div", { className: "tk-report-banner", children: [
            jsx("span", { style: { fontWeight: 600, color: "var(--dsw-alias-label-primary, #f3f4f6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: countLabel }),
            stat(added, removed),
          ] }),
          jsxs("div", { className: "tk-report-body", children: [
            shown.map((file) => {
              // Two-tone full path: the directory part dims to tertiary while
              // the file name stays primary and semibold — the DiffBlock path
              // treatment — so the edited file carries the row.
              // Split on either separator: a Windows path would otherwise keep
              // C:\src\ as part of the file name and render no directory.
              const at = Math.max(file.path.lastIndexOf("/"), file.path.lastIndexOf("\\"));
              const dir = at === -1 ? "" : file.path.slice(0, at + 1);
              const base = at === -1 ? file.path : file.path.slice(at + 1);
              return jsxs("button", {
                className: "tk-report-row",
                type: "button",
                title: file.path,
                "aria-label": t("reportOpenAria", { name: file.path }),
                onClick: () => { openFile?.(file.path); },
                style: { appearance: "none", border: "none", background: "none", font: "inherit", textAlign: "left", cursor: "pointer", width: "100%" },
                children: [
                  jsx("span", { className: "tk-report-path", style: { flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: [
                    dir !== "" ? jsx("span", { className: "tk-report-dir", children: dir }) : null,
                    jsx("span", { className: "tk-report-base", children: base }),
                  ] }),
                  stat(file.added, file.removed),
                ],
              }, file.path);
            }),
            hidden > 0 ? jsx("button", {
              type: "button",
              onClick: () => { setExpanded(true); },
              style: { appearance: "none", border: "none", background: "none", font: "inherit", textAlign: "left", cursor: "pointer", color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
              children: t("reportMore", { count: String(hidden) }),
            }) : null,
            canOpenPath && files.length > 0 ? jsx("button", {
              type: "button",
              // Reveal the first changed file in its folder. The stock
              // produced-files tail has no folder affordance of its own, so
              // gating this on `files.length > 1` only withheld it from the
              // commonest case without matching any host behaviour.
              onClick: () => { revealPath?.(files[0]?.path); },
              style: { alignSelf: "flex-end", appearance: "none", border: "none", background: "none", font: "inherit", cursor: "pointer", color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
              children: t("reportShowFolder"),
            }) : null,
          ] }),
        ],
      });
    }

    /** Optimizations surfaced by the settings card, in display order. */
    const OPTIMIZATIONS = [
      {
        key: "workspacelessChat",
        titleKey: "optChatTitle",
        shortKey: "optChatShort",
        descKey: "optChatDesc",
        icon: IconNewChatOutline16,
      },
      {
        key: "editLastMessage",
        titleKey: "optEditTitle",
        shortKey: "optEditShort",
        descKey: "optEditDesc",
        icon: IconEditOutline16,
      },
      {
        key: "viewActivity",
        titleKey: "optActivityTitle",
        shortKey: "optActivityShort",
        descKey: "optActivityDesc",
        icon: IconClockOutline16,
      },
      {
        key: "slashI18n",
        titleKey: "optI18nTitle",
        shortKey: "optI18nShort",
        descKey: "optI18nDesc",
        icon: IconGlobeOutline14,
      },
      {
        key: "changeReport",
        titleKey: "optReportTitle",
        shortKey: "optReportShort",
        descKey: "optReportDesc",
        icon: IconBranchOutline16,
      },
      {
        key: "opencodeSession",
        titleKey: "optSessionTitle",
        shortKey: "optSessionShort",
        descKey: "optSessionDesc",
        icon: IconApiOutline14,
      },
      {
        key: "modelCapability",
        titleKey: "optModelsTitle",
        shortKey: "optModelsShort",
        descKey: "optModelsDesc",
        icon: IconGaugeOutline16,
      },
    ];

    // ── workspacelessChat: auto-connect the default chat workspace ─────────────

    /**
     * Install the workspacelessChat optimization. Two duties:
     *  - UNCONDITIONALLY ensure the default chat workspace exists with its
     *    friendly title (when enabled), so the no-project option is always
     *    present in the sidebar and workspace picker;
     *  - auto-CONNECT a blank chat session only when both baselines are
     *    ready, no session is selected, and the runtime's own startup policy
     *    has no recent workspace to connect (it would have run already).
     * @param {{ workspaces: any, sessions: any }} services - injected runtime faces.
     * @param {any} scope - bound settings scope, or undefined when unavailable.
     * @returns {() => void} disposer for the effect teardown.
     */
    function installWorkspacelessChat(services, scope, ctx) {
      const workspaces = services?.workspaces ?? services?.get?.("workspaces");
      const sessions = services?.sessions ?? services?.get?.("sessions");
      // Every path below assumes these two list faces. Checking them up front
      // keeps a differently-shaped host from throwing inside the effect
      // factory — which would take down the whole install path — and matches
      // how the activity installer already guards itself.
      if (typeof workspaces?.list?.subscribe !== "function"
        || typeof workspaces?.list?.getSnapshot !== "function"
        || typeof sessions?.list?.subscribe !== "function"
        || typeof sessions?.list?.getSnapshot !== "function") {
        console.warn("[toolkit] workspacelessChat: workspaces/sessions list faces unavailable; optimization dormant");
        return () => {};
      }

      let busy = false;
      let attempts = 0;
      let retryTimer = undefined;
      let disposed = false;

      const readValue = () => {
        if (scope === undefined) return undefined;
        const snap = scope.getSnapshot?.();
        return snap?.status === "ready" ? snap.value : undefined;
      };

      /** The composition base layer: where the server keeps resolved defaults. */
      const readBase = () => {
        if (scope === undefined) return undefined;
        const snap = scope.getSnapshot?.();
        return snap?.status === "ready" ? snap.base : undefined;
      };

      /**
       * The chat workspace path to ensure. An explicitly stored value wins; an
       * empty one falls back to the composition base, which carries the
       * RESOLVED absolute path (the server substitutes <DSH_HOME>/chat).
       * Treating "" as "no path" silently disabled the optimization even though
       * the card documents empty as a valid "use the default".
       * @param {any} value - the resolved settings value.
       * @returns {string} the absolute path, or "" when nothing is resolvable.
       */
      const resolveChatPath = (value) => {
        const stored = typeof value?.chatWorkspacePath === "string" ? value.chatWorkspacePath.trim() : "";
        if (stored !== "") return stored;
        const base = readBase();
        return typeof base?.chatWorkspacePath === "string" ? base.chatWorkspacePath.trim() : "";
      };

      /** Basename of a host path, used to detect the auto-derived default title. */
      const basenameOf = (path) =>
        (String(path ?? "").replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "");

      /**
       * Rename the chat workspace to its friendly title when it still carries
       * the auto-derived basename ("chat"). A title the user set themselves is
       * never overwritten. Best-effort: rename failures only warn.
       * @param {{ workspaceId: string, path: string, title: string }} view - chat workspace view.
       * @returns {Promise<void>} completion of the rename check.
       */
      const ensureChatTitle = async (view) => {
        const value = readValue();
        const desired = typeof value?.chatWorkspaceTitle === "string"
          && value.chatWorkspaceTitle.trim() !== ""
          ? value.chatWorkspaceTitle.trim()
          : "通用对话";
        const stillDefault = view.title === basenameOf(view.path) || view.title === "";
        if (view.title === desired || !stillDefault) return;
        try {
          await workspaces.rename(view.workspaceId, desired);
          console.info(`[toolkit] renamed chat workspace to "${desired}"`);
        } catch (error) {
          console.warn("[toolkit] chat workspace rename failed:", error);
        }
      };

      /**
       * Ensure the default chat workspace EXISTS (idempotent host-side create)
       * with its friendly title, whenever the optimization is enabled. This is
       * unconditional: the no-project option must be present in the sidebar
       * and workspace picker, not only after a first-run connect. Best-effort:
       * failures only warn.
       * @returns {Promise<{ workspaceId: string, path: string, title: string } | undefined>}
       *   the ensured workspace view, or undefined when disabled/not ready.
       */
      const ensureChatWorkspace = async () => {
        const value = readValue();
        if (value === undefined) return undefined;
        if (value.optimizations?.workspacelessChat === false) return undefined;
        const chatPath = resolveChatPath(value);
        if (chatPath === "") return undefined;
        try {
          const ws = workspaces.list.getSnapshot();
          const existing = ws.items.find((item) => item.path === chatPath);
          // create() is idempotent host-side (resolveByPath first), so a stale
          // list snapshot self-heals instead of double-registering.
          const view = existing ?? (await workspaces.create({ path: chatPath }));
          await ensureChatTitle(view);
          return view;
        } catch (error) {
          console.warn("[toolkit] chat workspace ensure failed:", error);
          return undefined;
        }
      };

      const run = async () => {
        busy = true;
        try {
          const view = await ensureChatWorkspace();
          if (disposed) return;
          if (view === undefined) throw new Error("chat workspace path is not resolvable yet");
          const sessionId = await workspaces.connectWorkspace(view.workspaceId);
          // A teardown (HMR/remount, or the user switching the optimization
          // off) must not still connect a workspace or steal the selection.
          if (disposed) return;
          attempts = 0;
          if (sessions.list.getSnapshot().current === undefined) {
            const nav = services?.uiWorkspace ?? services?.get?.("uiWorkspace") ?? ctx?.uiWorkspace ?? ctx?.get?.("uiWorkspace");
            if (nav?.openSession) {
              nav.openSession(sessionId);
            } else if (sessions?.open) {
              sessions.open(sessionId);
            }
            console.info(`[toolkit] connected default chat workspace (${view.path})`);
          }
        } catch (error) {
          attempts += 1;
          console.warn("[toolkit] workspaceless chat connect failed:", error);
        } finally {
          busy = false;
        }
      };

      const check = () => {
        if (busy || retryTimer !== undefined) return;
        const value = readValue();
        // Before the settings section arrives the composition default
        // (enabled) applies; the chat path however needs the section, so the
        // connect itself waits for it through the scope subscription.
        const enabled = value?.optimizations?.workspacelessChat !== false;
        if (!enabled) return;
        const ws = workspaces.list.getSnapshot();
        if (!ws.baselinesReady) return;
        if (sessions.list.getSnapshot().current !== undefined) return;
        if (ws.recentWorkspaceId !== undefined) return;
        if (readValue() === undefined) return;
        void run().then(() => {
          // A persistent failure changed no list state, so no subscription
          // re-fires; retry a bounded number of times, then stay dormant.
          if (attempts > 0 && attempts < 3) {
            retryTimer = setTimeout(() => {
              retryTimer = undefined;
              check();
            }, 2000);
            retryTimer?.unref?.();
          }
        });
      };

      // Existence/title is unconditional (when enabled): re-ensure on every
      // list or settings change and once at install.
      const stop1 = workspaces.list.subscribe(() => {
        void ensureChatWorkspace();
        check();
      });
      const stop2 = sessions.list.subscribe(check);
      const stop3 = scope?.subscribe?.(() => {
        void ensureChatWorkspace();
        check();
      });
      void ensureChatWorkspace();
      check();
      return () => {
        disposed = true;
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        stop1();
        stop2();
        stop3?.();
      };
    }

    // ── modelCapability: searchable model-id picker ───────────────────────────

    /** Shared styles for the model-id picker fields. */
    const MKP = {
      label: { fontSize: "13.5px", fontWeight: 500, color: "var(--dsw-alias-label-primary, #f3f4f6)" },
      hint: { fontSize: "12px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
      count: { flexShrink: 0, fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
      box: {
        position: "relative",
        display: "flex", flexWrap: "wrap", alignItems: "center", gap: "4px",
        marginTop: "4px", padding: "5px 8px",
        minHeight: "34px", boxSizing: "border-box",
        background: "var(--dsw-alias-bg-layer-1, #161616)",
        border: "1px solid var(--dsw-alias-border-l2, #333)",
        borderRadius: "8px", cursor: "text",
      },
      chip: {
        display: "inline-flex", alignItems: "center", gap: "4px", maxWidth: "100%",
        padding: "1px 4px 1px 8px", borderRadius: "999px",
        fontSize: "12px", lineHeight: 1.7,
        color: "var(--dsw-alias-label-primary, #f3f4f6)",
        background: "var(--dsw-alias-bg-layer-3, #242424)",
        border: "1px solid var(--dsw-alias-border-l2, #333)",
      },
      chipText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
      chipRemove: {
        flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center",
        width: "16px", height: "16px", padding: 0, borderRadius: "50%",
        font: "inherit", fontSize: "13px", lineHeight: 1,
        color: "var(--dsw-alias-label-tertiary, #9ca3af)",
        background: "transparent", border: "none", cursor: "pointer",
      },
      input: {
        flex: "1 1 140px", minWidth: "120px",
        padding: "2px 0", fontSize: "12.5px", font: "inherit",
        color: "var(--dsw-alias-label-primary, #f3f4f6)",
        background: "transparent", border: "none", outline: "none",
      },
      panel: {
        // Floating overlay: absolutely positioned against the field box so the
        // dialog never grows or re-centers when the suggestions open. The
        // dialog's own overflow is switched to visible next to this rule.
        position: "absolute", left: 0, right: 0, zIndex: 5,
        overflowY: "auto", overscrollBehavior: "contain",
        background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
        border: "1px solid var(--dsw-alias-border-l2, #333)",
        borderRadius: "8px",
        boxShadow: "0 12px 32px rgba(0, 0, 0, 0.45)",
      },
      row: {
        display: "flex", alignItems: "baseline", gap: "8px", width: "100%",
        padding: "6px 10px", boxSizing: "border-box",
        appearance: "none", border: 0, background: "none",
        font: "inherit", textAlign: "left", cursor: "pointer",
      },
      rowActive: { background: "var(--dsw-alias-bg-layer-3, #242424)" },
      rowId: { fontSize: "12.5px", color: "var(--dsw-alias-label-primary, #f3f4f6)" },
      rowName: {
        fontSize: "11.5px", color: "var(--dsw-alias-label-tertiary, #9ca3af)",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      },
      empty: {
        padding: "8px 10px", fontSize: "12px", lineHeight: 1.5,
        color: "var(--dsw-alias-label-tertiary, #9ca3af)",
      },
    };

    /**
     * modelCapability model-id picker: a search-as-you-type token field. The
     * current selection renders as removable chips; typing filters the route's
     * known model ids and clicking a row (or Enter on the highlighted one) adds
     * it. Enter with no match adds the raw id, Backspace on an empty query
     * drops the last chip, and Escape closes the suggestion list before the
     * surrounding modal sees it.
     */
    function ModelIdPicker(props) {
      const {
        t, label, hint, values, options, optionsError, disabled,
        query, onQuery, open, onOpen, onAdd, onRemove,
      } = props;
      const [highlight, setHighlight] = useState(0);
      /** Where the overlay fits: below the field, or flipped above it. */
      const [placement, setPlacement] = useState({ side: "down", maxHeight: 240 });
      const wrapRef = useRef(null);
      const boxRef = useRef(null);
      const inputRef = useRef(null);

      const trimmed = query.trim();
      const lowered = trimmed.toLowerCase();
      const chosen = new Set(values);
      const matches = [];
      if (Array.isArray(options)) {
        for (const option of options) {
          if (option === null || typeof option?.id !== "string" || chosen.has(option.id)) continue;
          if (
            lowered === ""
            || option.id.toLowerCase().includes(lowered)
            || String(option.name ?? "").toLowerCase().includes(lowered)
          ) {
            matches.push(option);
            if (matches.length >= 50) break;
          }
        }
      }
      const freeAdd = trimmed !== "" && !chosen.has(trimmed) && !matches.some((option) => option.id === trimmed);

      // Close on any pointer press outside this field.
      useEffect(() => {
        if (!open) return undefined;
        const onPointerDown = (event) => {
          if (wrapRef.current && !wrapRef.current.contains(event.target)) onOpen(false);
        };
        document.addEventListener("pointerdown", onPointerDown);
        return () => document.removeEventListener("pointerdown", onPointerDown);
      }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

      // Keep the overlay inside the viewport: prefer below the field, flip
      // above when the lower half is too tight, and bound its height by the
      // room actually available. Re-measured on scroll/resize while open.
      useLayoutEffect(() => {
        if (!open) return undefined;
        const measure = () => {
          const box = boxRef.current;
          if (box === null || typeof window === "undefined") return;
          const rect = box.getBoundingClientRect();
          const below = window.innerHeight - rect.bottom - 12;
          const above = rect.top - 12;
          // Prefer the conventional downward panel, but only when the full
          // overlay fits below; otherwise use whichever side has more room
          // (both pickers sit low in this dialog, so they open upward with a
          // full-height list rather than a cramped strip at the screen edge).
          const side = below >= 240 || below >= above ? "down" : "up";
          const room = Math.max(side === "down" ? below : above, 96);
          setPlacement({ side, maxHeight: Math.min(260, Math.round(room)) });
        };
        measure();
        const onViewportChange = () => measure();
        window.addEventListener("resize", onViewportChange);
        // Capture phase: also catches the dialog's own scrolling ancestors.
        window.addEventListener("scroll", onViewportChange, true);
        return () => {
          window.removeEventListener("resize", onViewportChange);
          window.removeEventListener("scroll", onViewportChange, true);
        };
      }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

      // Keep the highlight inside the (re-filtered) match list.
      useEffect(() => {
        if (highlight >= matches.length) setHighlight(0);
      }, [highlight, matches.length]);

      const pick = (id) => {
        onAdd(id);
        onQuery("");
        setHighlight(0);
        inputRef.current?.focus();
      };

      const onKeyDown = (event) => {
        if (disabled) return;
        if (event.key === "ArrowDown") {
          event.preventDefault();
          if (!open) { onOpen(true); return; }
          setHighlight((current) => (matches.length === 0 ? 0 : Math.min(current + 1, matches.length - 1)));
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          setHighlight((current) => Math.max(current - 1, 0));
        } else if (event.key === "Enter") {
          event.preventDefault();
          // Only a highlighted row wins while the suggestion panel is open.
          // After Escape the panel is closed but `matches`/`highlight` are
          // still populated, so Enter used to add a stale suggestion instead of
          // the id the user typed.
          const target = open
            ? (matches[highlight]?.id ?? (freeAdd ? trimmed : undefined))
            : (freeAdd ? trimmed : undefined);
          if (target !== undefined) pick(target);
        } else if (event.key === "Backspace" && query === "" && values.length > 0) {
          onRemove(values[values.length - 1]);
        } else if (event.key === "Escape" && open) {
          // Close the suggestions first; a second Escape reaches the modal.
          event.stopPropagation();
          onOpen(false);
        }
      };

      let panel = null;
      if (open) {
        let content;
        if (optionsError !== null) {
          // Already a display string (built with t() where the failure was seen).
          content = jsx("div", { style: MKP.empty, children: optionsError });
        } else if (options === null) {
          content = jsx("div", { style: MKP.empty, children: t("modelsPickLoading") });
        } else if (matches.length > 0) {
          content = matches.map((option, index) => jsx("button", {
            type: "button",
            onMouseEnter: () => setHighlight(index),
            onClick: () => pick(option.id),
            style: { ...MKP.row, ...(index === highlight ? MKP.rowActive : {}) },
            children: [
              jsx("span", { style: MKP.rowId, children: option.id }),
              option.name !== undefined && option.name !== ""
                ? jsx("span", { style: MKP.rowName, children: option.name })
                : null,
            ],
          }, option.id));
        } else if (freeAdd) {
          content = jsx("div", { style: MKP.empty, children: t("modelsPickAddFree", { id: trimmed }) });
        } else if (trimmed !== "") {
          content = jsx("div", { style: MKP.empty, children: t("modelsPickEmpty") });
        } else {
          content = jsx("div", { style: MKP.empty, children: t("modelsPickNoOptions") });
        }
        panel = jsx("div", {
          style: {
            ...MKP.panel,
            top: placement.side === "down" ? "calc(100% + 4px)" : undefined,
            bottom: placement.side === "up" ? "calc(100% + 4px)" : undefined,
            maxHeight: `${placement.maxHeight}px`,
          },
          children: content,
        });
      }

      return jsxs("div", {
        ref: wrapRef,
        style: { display: "flex", flexDirection: "column", gap: "3px" },
        children: [
          jsxs("div", {
            style: { display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "8px" },
            children: [
              jsx("span", { style: MKP.label, children: label }),
              values.length > 0
                ? jsx("span", { style: MKP.count, children: t("modelsPickCount", { count: values.length }) })
                : null,
            ],
          }),
          jsxs("div", {
            ref: boxRef,
            style: { ...MKP.box, opacity: disabled ? 0.5 : 1 },
            onClick: () => {
              if (disabled) return;
              inputRef.current?.focus();
              onOpen(true);
            },
            children: [
              ...values.map((id) => jsxs("span", {
                style: MKP.chip,
                children: [
                  jsx("span", { style: MKP.chipText, children: id }),
                  jsx("button", {
                    type: "button",
                    disabled,
                    "aria-label": t("modelsPickRemove", { id }),
                    title: t("modelsPickRemove", { id }),
                    onClick: (event) => { event.stopPropagation(); onRemove(id); },
                    style: MKP.chipRemove,
                    children: "×",
                  }),
                ],
              }, id)),
              jsx("input", {
                ref: inputRef,
                value: query,
                disabled,
                spellCheck: false,
                autoComplete: "off",
                placeholder: values.length === 0 ? t("modelsPickSearch") : "",
                onFocus: () => onOpen(true),
                onChange: (event) => {
                  onQuery(event.target.value);
                  onOpen(true);
                  setHighlight(0);
                },
                onKeyDown,
                style: MKP.input,
              }),
              // The overlay lives inside the field box: the dialog never grows,
              // and a pointer press on a row still counts as "inside".
              panel,
            ],
          }),
          jsx("span", { style: MKP.hint, children: hint }),
        ],
      });
    }

    function IconSparkles(props) {
      const size = props?.size || 13;
      return jsx("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "currentColor",
        "aria-hidden": "true",
        style: { display: "inline-block", verticalAlign: "-0.15em", ...props?.style },
        children: jsx("path", {
          d: "M7.53 1.282a.5.5 0 0 1 .94 0l.974 2.825a3.5 3.5 0 0 0 2.158 2.158l2.825.974a.5.5 0 0 1 0 .94l-2.825.974a3.5 3.5 0 0 0-2.158 2.158l-.974 2.825a.5.5 0 0 1-.94 0l-.974-2.825a3.5 3.5 0 0 0-2.158-2.158L1.547 9.12a.5.5 0 0 1 0-.94l2.825-.974A3.5 3.5 0 0 0 6.53 5.048L7.53 1.282zM12.5 10.5a.3.3 0 0 1 .565 0l.27.784a1.5 1.5 0 0 0 .925.925l.784.27a.3.3 0 0 1 0 .565l-.784.27a1.5 1.5 0 0 0-.925.925l-.27.784a.3.3 0 0 1-.565 0l-.27-.784a1.5 1.5 0 0 0-.925-.925l-.784-.27a.3.3 0 0 1 0-.565l.784-.27a1.5 1.5 0 0 0 .925-.925l.27-.784z",
        }),
      });
    }

    function IconCompress(props) {
      const size = props?.size || 13;
      return jsxs("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { display: "inline-block", verticalAlign: "-0.15em", ...props?.style },
        children: [
          jsx("path", { d: "M2 3.5h12" }),
          jsx("path", { d: "M2 7.5h7" }),
          jsx("path", { d: "M2 11.5h12" }),
          jsx("path", { d: "M11 6.5l2 1-2 1" }),
        ],
      });
    }

    function IconReset(props) {
      const size = props?.size || 13;
      return jsxs("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.3",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { display: "inline-block", verticalAlign: "-0.15em", ...props?.style },
        children: [
          jsx("path", { d: "M2.5 8a5.5 5.5 0 1 0 1.6-3.9L2 6" }),
          jsx("path", { d: "M2 2.5V6h3.5" }),
        ],
      });
    }

    function IconCheck(props) {
      const size = props?.size || 13;
      return jsx("svg", {
        width: size,
        height: size,
        viewBox: "0 0 16 16",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: "1.5",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": "true",
        style: { display: "inline-block", verticalAlign: "-0.15em", ...props?.style },
        children: jsx("path", { d: "M3.5 8.5l3 3 6-7" }),
      });
    }

    /**
     * SlashI18n management panel: lists all detected slash commands and skills,
     * allows inline editing/fine-tuning of Chinese descriptions, batch or single-item
     * AI translation via existing system credentials, and live persistence.
     */
    function SlashI18nManager(props) {
      const { t, writable, onClose } = props;
      const [search, setSearch] = useState("");
      const [filter, setFilter] = useState("all");
      const [drafts, setDrafts] = useState(() => ({ ...customSlashZh }));
      const [items, setItems] = useState(() => getDiscoveredItemsList());
      const [isDirty, setIsDirty] = useState(false);
      const [saving, setSaving] = useState(false);
      const [savedTick, setSavedTick] = useState(false);
      const [error, setError] = useState(null);
      const [batchTranslating, setBatchTranslating] = useState(false);
      const [batchOptimizing, setBatchOptimizing] = useState(false);
      const [translatingKeys, setTranslatingKeys] = useState(() => new Set());
      const [optimizingKeys, setOptimizingKeys] = useState(() => new Set());

      useEffect(() => {
        let active = true;
        void (async () => {
          try {
            await probeRemoteCatalog();
            await loadCustomSlashTranslations();
            if (active) {
              setDrafts((prev) => ({ ...customSlashZh, ...prev }));
              setItems(getDiscoveredItemsList());
            }
          } catch (e) {
            console.warn("[toolkit] error syncing slash catalog:", e);
          }
        })();
        return () => { active = false; };
      }, []);

      const totalCount = items.length;
      const untranslatedItems = items.filter((it) => {
        const desc = it.description || "";
        const currentZh = (drafts[desc] !== undefined ? drafts[desc] : (SLASH_ZH[desc] || "")).trim();
        return currentZh === "";
      });
      const untranslatedCount = untranslatedItems.length;
      const translatedCount = totalCount - untranslatedCount;

      const longItems = items.filter((it) => (it.description || "").length > 50);
      const optimizeCandidates = untranslatedItems.length > 0
        ? untranslatedItems
        : longItems;

      const filteredItems = items.filter((it) => {
        const desc = it.description || "";
        const name = it.name || "";
        const currentZh = (drafts[desc] !== undefined ? drafts[desc] : (SLASH_ZH[desc] || "")).trim();
        const isUntranslated = currentZh === "";

        if (filter === "untranslated" && !isUntranslated) return false;
        if (filter === "command" && it.type !== "command" && it.type !== "hint") return false;
        if (filter === "skill" && it.type !== "skill") return false;

        if (search.trim()) {
          const q = search.toLowerCase();
          const matchName = name.toLowerCase().includes(q);
          const matchDesc = desc.toLowerCase().includes(q);
          const matchZh = currentZh.toLowerCase().includes(q);
          if (!matchName && !matchDesc && !matchZh) return false;
        }
        return true;
      });

      const handleSingleAiAction = async (item, mode = "translate") => {
        const desc = item.description;
        if (!desc) return;
        setError(null);
        if (mode === "optimize") {
          setOptimizingKeys((prev) => new Set(prev).add(desc));
        } else {
          setTranslatingKeys((prev) => new Set(prev).add(desc));
        }
        try {
          const res = await fetch("/api/toolkit/translate-slash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ name: item.name, text: desc }],
              mode,
            }),
          });
          const data = await res.json();
          const trans = data.translations || {};
          const matchedVal = trans[desc] || trans[item.name];
          if (data.ok && matchedVal) {
            setDrafts((prev) => ({ ...prev, [desc]: matchedVal }));
            setIsDirty(true);
          } else if (data.ok && Object.keys(trans).length > 0) {
            const firstVal = Object.values(trans)[0];
            setDrafts((prev) => ({ ...prev, [desc]: firstVal }));
            setIsDirty(true);
          } else {
            setError(data.error || "AI 处理失败");
          }
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          if (mode === "optimize") {
            setOptimizingKeys((prev) => {
              const next = new Set(prev);
              next.delete(desc);
              return next;
            });
          } else {
            setTranslatingKeys((prev) => {
              const next = new Set(prev);
              next.delete(desc);
              return next;
            });
          }
        }
      };

      const handleBatchAiAction = async (mode = "translate") => {
        const targetList = mode === "optimize" ? optimizeCandidates : untranslatedItems;
        if (targetList.length === 0) return;
        setError(null);
        if (mode === "optimize") {
          setBatchOptimizing(true);
        } else {
          setBatchTranslating(true);
        }
        try {
          const payloadItems = targetList.map((it) => ({
            name: it.name,
            text: it.description,
          }));
          const res = await fetch("/api/toolkit/translate-slash", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: payloadItems,
              mode,
            }),
          });
          const data = await res.json();
          if (data.ok && data.translations) {
            setDrafts((prev) => {
              const next = { ...prev };
              for (const it of targetList) {
                const text = it.description;
                const val = data.translations[text] || data.translations[it.name];
                if (val) next[text] = val;
              }
              return { ...next, ...data.translations };
            });
            setIsDirty(true);
          } else {
            setError(data.error || "AI 批量处理失败");
          }
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          if (mode === "optimize") {
            setBatchOptimizing(false);
          } else {
            setBatchTranslating(false);
          }
        }
      };

      const handleResetItem = (item) => {
        const desc = item.description;
        const defaultVal = SLASH_ZH[desc] || "";
        setDrafts((prev) => ({ ...prev, [desc]: defaultVal }));
        setIsDirty(true);
      };

      const handleSave = async () => {
        setError(null);
        setSaving(true);
        try {
          const res = await fetch("/api/toolkit/slash-translations", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              translations: drafts,
              discovered: items,
            }),
          });
          const data = await res.json();
          if (data.ok) {
            customSlashZh = { ...customSlashZh, ...drafts };
            setIsDirty(false);
            setSavedTick(true);
            setTimeout(() => setSavedTick(false), 2500);
          } else {
            setError(data.error || "保存失败");
          }
        } catch (err) {
          setError(err?.message || String(err));
        } finally {
          setSaving(false);
        }
      };

      const chipStyle = (active) => ({
        height: "26px",
        boxSizing: "border-box",
        padding: "0 10px",
        borderRadius: "6px",
        fontSize: "12px",
        font: "inherit",
        cursor: "pointer",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        color: active ? "var(--dsw-alias-label-primary, #f3f4f6)" : "var(--dsw-alias-label-tertiary, #9ca3af)",
        background: active ? "var(--dsw-alias-bg-layer-3, #2a2a2a)" : "transparent",
        border: active ? "1px solid var(--dsw-alias-border-l1, #444)" : "1px solid transparent",
        transition: "all .12s",
      });

      const isAnyBatchRunning = batchTranslating || batchOptimizing;

      return jsxs("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: "10px",
          padding: "10px 16px 14px",
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
        },
        children: [
          jsxs("div", {
            style: { display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" },
            children: [
              jsx("input", {
                type: "text",
                value: search,
                onChange: (e) => setSearch(e.target.value),
                placeholder: t("slashI18nSearchPlaceholder"),
                style: {
                  flex: 1,
                  minWidth: "160px",
                  height: "32px",
                  boxSizing: "border-box",
                  padding: "0 12px",
                  fontSize: "12.5px",
                  borderRadius: "6px",
                  background: "var(--dsw-alias-bg-layer-1, #141414)",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  color: "var(--dsw-alias-label-primary, #f3f4f6)",
                },
              }),
              jsxs("div", {
                style: {
                  display: "inline-flex",
                  alignItems: "center",
                  height: "32px",
                  boxSizing: "border-box",
                  gap: "3px",
                  background: "var(--dsw-alias-bg-layer-1, #141414)",
                  padding: "2px",
                  borderRadius: "8px",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                },
                children: [
                  jsx("button", {
                    type: "button",
                    onClick: () => setFilter("all"),
                    style: chipStyle(filter === "all"),
                    children: t("slashI18nFilterAll"),
                  }),
                  jsx("button", {
                    type: "button",
                    onClick: () => setFilter("untranslated"),
                    style: chipStyle(filter === "untranslated"),
                    children: jsxs("span", {
                      children: [
                        t("slashI18nFilterUntranslated"),
                        untranslatedCount > 0 ? jsx("span", {
                          style: {
                            marginLeft: "4px",
                            padding: "1px 5px",
                            borderRadius: "10px",
                            background: "#b91c1c",
                            color: "#fff",
                            fontSize: "10px",
                            fontWeight: "bold",
                          },
                          children: untranslatedCount,
                        }) : null,
                      ],
                    }),
                  }),
                  jsx("button", {
                    type: "button",
                    onClick: () => setFilter("command"),
                    style: chipStyle(filter === "command"),
                    children: t("slashI18nFilterCommand"),
                  }),
                  jsx("button", {
                    type: "button",
                    onClick: () => setFilter("skill"),
                    style: chipStyle(filter === "skill"),
                    children: t("slashI18nFilterSkill"),
                  }),
                ],
              }),
            ],
          }),
          jsxs("div", {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              fontSize: "12px",
              color: "var(--dsw-alias-label-tertiary, #9ca3af)",
              flexWrap: "wrap",
              gap: "8px",
            },
            children: [
              jsx("span", {
                children: t("slashI18nStats", {
                  total: totalCount,
                  translated: translatedCount,
                  untranslated: untranslatedCount,
                }),
              }),
              jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: "6px" },
                children: [
                  jsx("button", {
                    type: "button",
                    disabled: !writable || isAnyBatchRunning || untranslatedCount === 0,
                    onClick: () => handleBatchAiAction("translate"),
                    style: {
                      height: "28px",
                      boxSizing: "border-box",
                      padding: "0 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      font: "inherit",
                      cursor: (untranslatedCount > 0 && !isAnyBatchRunning) ? "pointer" : "default",
                      color: "#93c5fd",
                      background: "rgba(37, 99, 235, 0.12)",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      opacity: (untranslatedCount > 0 && !isAnyBatchRunning) ? 1 : 0.5,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "5px",
                      whiteSpace: "nowrap",
                    },
                    children: jsxs("span", {
                      style: { display: "inline-flex", alignItems: "center", gap: "5px" },
                      children: [
                        jsx(IconSparkles, { size: 12 }),
                        batchTranslating
                          ? t("slashI18nBatchAiLoading", { n: untranslatedCount })
                          : t("slashI18nBatchAi"),
                      ],
                    }),
                  }),
                  jsx("button", {
                    type: "button",
                    disabled: !writable || isAnyBatchRunning || optimizeCandidates.length === 0,
                    onClick: () => handleBatchAiAction("optimize"),
                    title: "将长文案或未翻译项通过 AI 归纳精简为适合斜杠下拉菜单的短描述 (12-28字)",
                    style: {
                      height: "28px",
                      boxSizing: "border-box",
                      padding: "0 10px",
                      borderRadius: "6px",
                      fontSize: "12px",
                      font: "inherit",
                      cursor: (optimizeCandidates.length > 0 && !isAnyBatchRunning) ? "pointer" : "default",
                      color: "#c084fc",
                      background: "rgba(168, 85, 247, 0.12)",
                      border: "1px solid rgba(192, 132, 252, 0.3)",
                      opacity: (optimizeCandidates.length > 0 && !isAnyBatchRunning) ? 1 : 0.5,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "5px",
                      whiteSpace: "nowrap",
                    },
                    children: jsxs("span", {
                      style: { display: "inline-flex", alignItems: "center", gap: "5px" },
                      children: [
                        jsx(IconCompress, { size: 12 }),
                        batchOptimizing
                          ? t("slashI18nBatchAiOptimizeLoading", { n: optimizeCandidates.length })
                          : t("slashI18nBatchAiOptimize"),
                      ],
                    }),
                  }),
                ],
              }),
            ],
          }),
          jsx("div", {
            style: {
              display: "flex",
              flexDirection: "column",
              gap: "8px",
              maxHeight: "360px",
              overflowY: "auto",
              paddingRight: "4px",
            },
            children: filteredItems.length === 0
              ? jsx("div", {
                  style: {
                    padding: "32px 16px",
                    textAlign: "center",
                    color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                    fontSize: "13px",
                  },
                  children: t("slashI18nEmptyFilter"),
                })
              : filteredItems.map((item, idx) => {
                  const desc = item.description;
                  const currentVal = drafts[desc] !== undefined ? drafts[desc] : (SLASH_ZH[desc] || "");
                  const isTranslating = translatingKeys.has(desc);
                  const isOptimizing = optimizingKeys.has(desc);
                  const isBusy = isTranslating || isOptimizing || isAnyBatchRunning;
                  const isCustom = Object.prototype.hasOwnProperty.call(customSlashZh, desc);
                  const isBuiltin = Object.prototype.hasOwnProperty.call(SLASH_ZH, desc);
                  const isTypeCommand = item.type === "command" || item.type === "hint";
                  const isLong = (desc || "").length > 60;

                  return jsxs("div", {
                    key: item.name + "_" + idx,
                    style: {
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      padding: "10px 12px",
                      borderRadius: "8px",
                      background: "var(--dsw-alias-bg-layer-1, #141414)",
                      border: "1px solid var(--dsw-alias-border-l2, #2a2a2a)",
                    },
                    children: [
                      jsxs("div", {
                        style: { display: "flex", alignItems: "center", gap: "8px" },
                        children: [
                          jsx("span", {
                            style: {
                              fontSize: "10.5px",
                              fontWeight: 600,
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: isTypeCommand ? "rgba(37, 99, 235, 0.18)" : "rgba(168, 85, 247, 0.18)",
                              color: isTypeCommand ? "#93c5fd" : "#d8b4fe",
                              border: isTypeCommand ? "1px solid rgba(96, 165, 250, 0.3)" : "1px solid rgba(192, 132, 252, 0.3)",
                            },
                            children: isTypeCommand ? (item.type === "hint" ? "提示" : "命令") : "技能",
                          }),
                          jsx("span", {
                            style: {
                              fontSize: "12.5px",
                              fontWeight: 600,
                              fontFamily: "monospace",
                              color: "var(--dsw-alias-label-primary, #f3f4f6)",
                            },
                            children: item.name,
                          }),
                          isLong ? jsx("span", {
                            style: {
                              fontSize: "10px",
                              padding: "1px 4px",
                              borderRadius: "4px",
                              background: "rgba(245, 158, 11, 0.15)",
                              color: "#fbbf24",
                              border: "1px solid rgba(251, 191, 36, 0.3)",
                            },
                            children: t("slashI18nTagLong"),
                          }) : null,
                          jsx("span", {
                            style: {
                              marginLeft: "auto",
                              fontSize: "10.5px",
                              padding: "1px 5px",
                              borderRadius: "4px",
                              background: isCustom ? "rgba(34, 197, 94, 0.15)" : (isBuiltin ? "rgba(156, 163, 175, 0.12)" : "rgba(239, 68, 68, 0.15)"),
                              color: isCustom ? "#4ade80" : (isBuiltin ? "#9ca3af" : "#f87171"),
                              border: isCustom ? "1px solid rgba(74, 222, 128, 0.25)" : (isBuiltin ? "1px solid rgba(156, 163, 175, 0.25)" : "1px solid rgba(248, 113, 113, 0.25)"),
                            },
                            children: isCustom ? t("slashI18nTagCustom") : (isBuiltin ? t("slashI18nTagBuiltin") : t("slashI18nFilterUntranslated")),
                          }),
                        ],
                      }),
                      jsx("div", {
                        style: {
                          fontSize: "11.5px",
                          lineHeight: 1.4,
                          color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                          background: "rgba(0, 0, 0, 0.2)",
                          padding: "4px 8px",
                          borderRadius: "5px",
                          wordBreak: "break-word",
                        },
                        children: desc,
                      }),
                      jsxs("div", {
                        style: { display: "flex", alignItems: "center", gap: "6px" },
                        children: [
                          jsx("input", {
                            type: "text",
                            value: currentVal,
                            disabled: !writable || saving || isBusy,
                            placeholder: t("slashI18nPlaceholderTranslation"),
                            onChange: (e) => {
                              const v = e.target.value;
                              setDrafts((prev) => ({ ...prev, [desc]: v }));
                              setIsDirty(true);
                            },
                            style: {
                              flex: 1,
                              height: "32px",
                              boxSizing: "border-box",
                              padding: "0 10px",
                              fontSize: "12.5px",
                              borderRadius: "6px",
                              background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
                              border: "1px solid var(--dsw-alias-border-l2, #333)",
                              color: "var(--dsw-alias-label-primary, #f3f4f6)",
                            },
                          }),
                          jsx("button", {
                            type: "button",
                            disabled: !writable || saving || isBusy,
                            onClick: () => handleSingleAiAction(item, "translate"),
                            title: t("slashI18nAiButton"),
                            style: {
                              height: "32px",
                              boxSizing: "border-box",
                              padding: "0 10px",
                              borderRadius: "6px",
                              fontSize: "12px",
                              font: "inherit",
                              cursor: "pointer",
                              color: "#93c5fd",
                              background: "rgba(37, 99, 235, 0.12)",
                              border: "1px solid rgba(59, 130, 246, 0.3)",
                              opacity: isTranslating ? 0.5 : 1,
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "5px",
                            },
                            children: jsxs("span", {
                              style: { display: "inline-flex", alignItems: "center", gap: "5px" },
                              children: [
                                jsx(IconSparkles, { size: 12 }),
                                isTranslating ? "…" : t("slashI18nAiButton"),
                              ],
                            }),
                          }),
                          isLong ? jsx("button", {
                            type: "button",
                            disabled: !writable || saving || isBusy,
                            onClick: () => handleSingleAiAction(item, "optimize"),
                            title: "通过 AI 提炼核心功能，精简归纳为短句",
                            style: {
                              height: "32px",
                              boxSizing: "border-box",
                              padding: "0 10px",
                              borderRadius: "6px",
                              fontSize: "12px",
                              font: "inherit",
                              cursor: "pointer",
                              color: "#c084fc",
                              background: "rgba(168, 85, 247, 0.12)",
                              border: "1px solid rgba(192, 132, 252, 0.3)",
                              opacity: isOptimizing ? 0.5 : 1,
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: "5px",
                            },
                            children: jsxs("span", {
                              style: { display: "inline-flex", alignItems: "center", gap: "5px" },
                              children: [
                                jsx(IconCompress, { size: 12 }),
                                isOptimizing ? "…" : t("slashI18nAiOptimize"),
                              ],
                            }),
                          }) : null,
                          jsx("button", {
                            type: "button",
                            disabled: !writable || saving || isBusy,
                            onClick: () => handleResetItem(item),
                            title: t("slashI18nResetButton"),
                            style: {
                              height: "32px",
                              width: "32px",
                              minWidth: "32px",
                              boxSizing: "border-box",
                              padding: 0,
                              borderRadius: "6px",
                              fontSize: "12px",
                              font: "inherit",
                              cursor: "pointer",
                              color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                              background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
                              border: "1px solid var(--dsw-alias-border-l2, #333)",
                              whiteSpace: "nowrap",
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                            },
                            children: jsx(IconReset, { size: 14 }),
                          }),
                        ],
                      }),
                    ],
                  });
                }),
          }),
          jsxs("div", {
            style: {
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              paddingTop: "14px",
              marginTop: "6px",
              borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
              flexWrap: "wrap",
              gap: "10px",
            },
            children: [
              jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: "8px", minHeight: "24px" },
                children: [
                  savedTick ? jsxs("span", {
                    style: {
                      fontSize: "12.5px",
                      color: "#4ade80",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "5px",
                      background: "rgba(34, 197, 94, 0.12)",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      border: "1px solid rgba(74, 222, 128, 0.25)",
                    },
                    children: [
                      jsx(IconCheck, { size: 13 }),
                      t("slashI18nSavedNotice"),
                    ],
                  }) : null,
                  error !== null ? jsx("span", {
                    style: {
                      fontSize: "12px",
                      color: "var(--dsw-alias-state-error-primary, #ef4444)",
                      background: "rgba(239, 68, 68, 0.1)",
                      padding: "3px 8px",
                      borderRadius: "6px",
                    },
                    children: `${t("saveError")}: ${error}`,
                  }) : null,
                  !savedTick && error === null && isDirty ? jsx("span", {
                    style: {
                      fontSize: "12px",
                      color: "#fbbf24",
                      background: "rgba(245, 158, 11, 0.12)",
                      padding: "3px 8px",
                      borderRadius: "6px",
                      border: "1px solid rgba(251, 191, 36, 0.25)",
                    },
                    children: "有未保存的修改",
                  }) : null,
                ],
              }),
              jsxs("div", {
                style: { display: "flex", alignItems: "center", gap: "8px", marginLeft: "auto" },
                children: [
                  jsx("button", {
                    type: "button",
                    disabled: !writable || !isDirty || saving,
                    onClick: handleSave,
                    style: {
                      height: "34px",
                      boxSizing: "border-box",
                      padding: "0 18px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 500,
                      font: "inherit",
                      cursor: (writable && isDirty && !saving) ? "pointer" : "default",
                      color: "var(--dsw-alias-label-primary-inverted, #fff)",
                      background: "var(--dsw-alias-brand-primary, #2563eb)",
                      border: "1px solid transparent",
                      opacity: writable && isDirty && !saving ? 1 : 0.5,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "6px",
                      whiteSpace: "nowrap",
                    },
                    children: [
                      saving ? "…" : (savedTick ? jsx(IconCheck, { size: 13 }) : null),
                      t("slashI18nSave"),
                    ],
                  }),
                  props.onClose ? jsx("button", {
                    type: "button",
                    onClick: props.onClose,
                    style: {
                      height: "34px",
                      boxSizing: "border-box",
                      padding: "0 18px",
                      borderRadius: "8px",
                      fontSize: "13px",
                      fontWeight: 500,
                      font: "inherit",
                      cursor: "pointer",
                      color: "var(--dsw-alias-label-primary, #f3f4f6)",
                      background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
                      border: "1px solid var(--dsw-alias-border-l2, #333)",
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      whiteSpace: "nowrap",
                    },
                    children: t("done"),
                  }) : null,
                ],
              }),
            ],
          }),
        ],
      });
    }

    // ── settings card ─────────────────────────────────────────────────────────

    /**
     * Plugins-page settings card: clicking the card expands an inline list of
     * per-optimization sub-cards (icon + title + subtitle + status), and
     * clicking one sub-card opens that optimization's settings modal. Writes
     * go through the bound settings scope, so toggles apply live without a
     * restart. The two-level layout keeps the plugins page a clean launcher
     * as the optimization list grows.
     */
    function ToolkitSettingsCard(props) {
      const { t, useToolkitSettings, toolkitSet, toolkitMutate, toolkitModels } = props;
      // Called unconditionally: a hook inside a conditional expression is a
      // rules-of-hooks violation, and the `props.scope` fallback the old
      // ternary carried was unreachable anyway — `inject` only ever passes the
      // `hooks.toolkitSettings` seat.
      const snap = (useToolkitSettings?.((s) => s)) ?? {};
      const value = snap.value ?? {};
      const writable = snap.writable === true;
      const opts = value.optimizations ?? {};

      const [expanded, setExpanded] = useState(props.view === "page");
      const [modalOpt, setModalOpt] = useState(null);
      const [saving, setSaving] = useState(false);
      const [savedTick, setSavedTick] = useState(false);
      const [error, setError] = useState(null);
      const [pathDraft, setPathDraft] = useState("");
      const [pathDirty, setPathDirty] = useState(false);
      const pathInput = useRef(null);
      /** modelCapability fields: key + forced vision / text-only selections. */
      const [modelsKeyDraft, setModelsKeyDraft] = useState("");
      const [modelsVisionDraft, setModelsVisionDraft] = useState([]);
      const [modelsTextOnlyDraft, setModelsTextOnlyDraft] = useState([]);
      const [modelsDirty, setModelsDirty] = useState(false);
      /** Model-id picker: per-field search text, which field is open, and the
       *  route's known models (null while loading). */
      const [visionQuery, setVisionQuery] = useState("");
      const [textOnlyQuery, setTextOnlyQuery] = useState("");
      const [pickerFor, setPickerFor] = useState(null);
      const [modelOptions, setModelOptions] = useState(null);
      const [modelOptionsError, setModelOptionsError] = useState(null);
      /**
       * The injected candidate loader and the translator, kept fresh on every
       * render. The candidates effect keys on the dialog alone (so a new `t`
       * identity cannot re-trigger the fetch) yet must not read a stale
       * closure — refs give it both.
       */
      const modelsLoaderRef = useRef(toolkitModels);
      const tRef = useRef(t);
      modelsLoaderRef.current = toolkitModels;
      tRef.current = t;

      // The "saved" badge is transient feedback, like the copy check.
      useEffect(() => {
        if (!savedTick) return undefined;
        const timer = setTimeout(() => { setSavedTick(false); }, 1500);
        return () => { clearTimeout(timer); };
      }, [savedTick]);

      // Sync the directory draft from the live value until the user edits it.
      useEffect(() => {
        if (pathDirty) return;
        setPathDraft(typeof value.chatWorkspacePath === "string" ? value.chatWorkspacePath : "");
      }, [value.chatWorkspacePath, pathDirty]);

      // Same contract for the model fields: the live section wins until the
      // user starts editing, then the draft is authoritative.
      useEffect(() => {
        if (modelsDirty) return;
        setModelsKeyDraft(typeof value.modelsApiKey === "string" ? value.modelsApiKey : "");
        setModelsVisionDraft(Array.isArray(value.modelsVision) ? [...value.modelsVision] : []);
        setModelsTextOnlyDraft(Array.isArray(value.modelsTextOnly) ? [...value.modelsTextOnly] : []);
      }, [value.modelsApiKey, value.modelsVision, value.modelsTextOnly, modelsDirty]);

      // Load the picker's candidates when the modelCapability modal opens.
      // Offline in-process read on the server; failure just leaves free-form
      // entry working.
      useEffect(() => {
        if (modalOpt !== "modelCapability") {
          setModelOptions(null);
          setModelOptionsError(null);
          setPickerFor(null);
          return undefined;
        }
        let cancelled = false;
        setModelOptionsError(null);
        // Read through refs so the effect stays keyed on the dialog while still
        // seeing the newest loader / translator.
        const loader = modelsLoaderRef.current;
        void (async () => {
          // A missing loader is a wiring bug, never "this route has no
          // models": say so instead of silently rendering an empty list.
          if (typeof loader !== "function") {
            if (!cancelled) {
              setModelOptions([]);
              setModelOptionsError(tRef.current("modelsPickUnavailable"));
            }
            return;
          }
          try {
            const result = await loader();
            if (cancelled) return;
            // The route reports its own failures (`ok: false` + a coded error)
            // so a misconfigured or unregistered route is not mistaken for
            // "this route has no models".
            if (result?.ok === false) {
              setModelOptions([]);
              setModelOptionsError(tRef.current("modelsPickFailed", {
                message: result.error?.message ?? result.error?.code ?? "route unavailable",
              }));
              return;
            }
            setModelOptions(Array.isArray(result?.models) ? result.models : []);
          } catch (cause) {
            if (!cancelled) {
              setModelOptions([]);
              setModelOptionsError(tRef.current("modelsPickFailed", { message: cause?.message ?? String(cause) }));
            }
          }
        })();
        return () => { cancelled = true; };
        // Keyed on the dialog alone: the loader and translator are read through
        // refs so a re-created `t` identity cannot re-trigger the fetch, while
        // the closure still sees their latest values.
      }, [modalOpt]);

      const write = async (field, next) => {
        setSaving(true);
        setError(null);
        try {
          await toolkitSet(field, next);
          setSavedTick(true);
          return true;
        } catch (cause) {
          setError(cause?.message ?? String(cause));
          return false;
        } finally {
          setSaving(false);
        }
      };

      const toggle = (key, next) => write("optimizations", { ...opts, [key]: next });

      /**
       * Enable or disable every optimization with one action. Keys this client
       * does not recognize are carried through: a host that gained an eighth
       * optimization must not have the user's setting for it reset to the
       * schema default by one click on "disable all".
       */
      const setAll = (on) => write(
        "optimizations",
        {
          ...opts,
          ...Object.fromEntries(OPTIMIZATIONS.map((opt) => [opt.key, on])),
        },
      );

      const savePath = () => {
        void (async () => {
          // Clear the dirty bit only AFTER the write lands. Clearing it up
          // front let the next snapshot overwrite the input with the server
          // value, silently discarding an edit whose save had just failed.
          if (await write("chatWorkspacePath", pathDraft.trim())) setPathDirty(false);
        })();
      };

      /**
       * Add / remove one model id in either override list. The two lists are
       * mutually exclusive — the server lets vision win anyway, and keeping
       * them disjoint makes the chips readable.
       */
      const addVisionId = (id) => {
        setModelsVisionDraft((current) => (current.includes(id) ? current : [...current, id]));
        setModelsTextOnlyDraft((current) => current.filter((entry) => entry !== id));
        setModelsDirty(true);
      };
      const removeVisionId = (id) => {
        setModelsVisionDraft((current) => current.filter((entry) => entry !== id));
        setModelsDirty(true);
      };
      const addTextOnlyId = (id) => {
        setModelsTextOnlyDraft((current) => (current.includes(id) ? current : [...current, id]));
        setModelsVisionDraft((current) => current.filter((entry) => entry !== id));
        setModelsDirty(true);
      };
      const removeTextOnlyId = (id) => {
        setModelsTextOnlyDraft((current) => current.filter((entry) => entry !== id));
        setModelsDirty(true);
      };

      /** Persist only the model fields the user actually changed. */
      const saveModels = () => {
        setModelsDirty(false);
        void (async () => {
          setSaving(true);
          setError(null);
          try {
            const key = modelsKeyDraft.trim();
            const wantsKey = key !== (value.modelsApiKey ?? "");
            const wantsVision = JSON.stringify(modelsVisionDraft) !== JSON.stringify(value.modelsVision ?? []);
            const wantsTextOnly = JSON.stringify(modelsTextOnlyDraft) !== JSON.stringify(value.modelsTextOnly ?? []);
            // Prefer one atomic namespace mutation over a write per field; a
            // host without `mutate` falls back to the ordered single writes.
            if (typeof toolkitMutate === "function") {
              const ops = [];
              if (wantsKey) ops.push({ op: "set", path: ["modelsApiKey"], value: key });
              if (wantsVision) ops.push({ op: "set", path: ["modelsVision"], value: modelsVisionDraft });
              if (wantsTextOnly) ops.push({ op: "set", path: ["modelsTextOnly"], value: modelsTextOnlyDraft });
              if (ops.length > 0) await toolkitMutate(ops);
            } else {
              if (wantsKey) await toolkitSet("modelsApiKey", key);
              if (wantsVision) await toolkitSet("modelsVision", modelsVisionDraft);
              if (wantsTextOnly) await toolkitSet("modelsTextOnly", modelsTextOnlyDraft);
            }
            setSavedTick(true);
          } catch (cause) {
            setError(cause?.message ?? String(cause));
            // Keep the draft dirty: the edit did not land, and clearing the
            // flag here made the next snapshot overwrite it.
            return;
          } finally {
            setSaving(false);
          }
          setModelsDirty(false);
        })();
      };

      if (props.view === "summary") {
        return t("cardDesc");
      }

      const enabledCount = OPTIMIZATIONS.filter((opt) => opts[opt.key] === true).length;
      const activeOpt = modalOpt === null ? null : OPTIMIZATIONS.find((opt) => opt.key === modalOpt);
      const statusLine =
        // A provider that has not resolved yet is not the same as a read-only
        // one: reporting "read only" for it would look like a working card
        // whose toggles silently do nothing.
        snap.status !== "ready"
          ? t("statusLoading")
          : snap.mode === "memory"
            ? t("statusMemory")
            : snap.writable
              ? savedTick ? t("statusSaved") : ""
              : t("statusReadOnly");

      /** One optimization's on/off switch (lives inside its settings modal; the
       *  modal header already carries the title + description, so the row shows
       *  only a simple enable label, not a duplicate). */
      const switchRow = (opt) => {
        const on = opts[opt.key] === true;
        return jsxs("div", {
          style: {
            display: "flex", alignItems: "center", gap: "12px",
            padding: "12px 16px",
            borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
          },
          children: [
            jsx("span", {
              style: { flex: 1, minWidth: 0, fontSize: "13.5px", fontWeight: 500, color: "var(--dsw-alias-label-primary, #f3f4f6)" },
              children: t("optEnableLabel"),
            }),
            // A proper switch, matching dsh's own toggle recipe (TrajectoryToolbar):
            // track + sliding thumb, filled with the state-business-primary accent
            // when on, neutral when off.
            jsx("button", {
              type: "button",
              role: "switch",
              "aria-checked": on,
              "aria-label": t(opt.titleKey),
              title: on ? t("toggleOn") : t("toggleOff"),
              disabled: !writable || saving,
              onClick: () => { void toggle(opt.key, !on); },
              style: {
                flexShrink: 0, marginTop: "2px",
                position: "relative", display: "inline-block",
                width: "40px", height: "22px", borderRadius: "999px",
                padding: 0, font: "inherit",
                border: "1px solid " + (on
                  ? "transparent"
                  : "var(--dsw-alias-interactive-border, var(--dsw-alias-border-l2, #333))"),
                background: on
                  ? "var(--dsw-alias-state-business-primary, #2563eb)"
                  : "rgba(148, 163, 184, 0.35)",

                transition: "background .18s, border-color .18s",
                cursor: writable && !saving ? "pointer" : "default",
                opacity: writable ? 1 : 0.5,
              },
              children: jsx("span", {
                style: {
                  position: "absolute", top: "1px", left: "1px",
                  width: "18px", height: "18px", borderRadius: "50%",
                  background: "#fff",
                  boxShadow: "0 1px 3px rgba(0, 0, 0, 0.45)",
                  transform: on ? "translateX(18px)" : "translateX(0)",
                  transition: "transform .18s",
                },
              }),
            }),
          ],
        }, opt.key);
      };

      /** The chat-directory configuration group shared by chat-related settings. */
      const chatPathGroup = jsxs("div", {
        style: {
          display: "flex", alignItems: "flex-start", gap: "12px",
          padding: "10px 16px 14px",
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
        },
        children: [
          jsxs("div", {
            style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "3px" },
            children: [
              jsx("label", {
                htmlFor: "toolkit-chat-path",
                style: {
                  fontSize: "13.5px", fontWeight: 500,
                  color: "var(--dsw-alias-label-primary, #f3f4f6)",
                },
                children: t("chatPathLabel"),
              }),
              jsx("input", {
                id: "toolkit-chat-path",
                ref: pathInput,
                value: pathDraft,
                disabled: !writable || saving,
                spellCheck: false,
                onChange: (event) => {
                  setPathDraft(event.target.value);
                  setPathDirty(true);
                },
                onKeyDown: (event) => {
                  if (event.key === "Enter" && writable && !saving) savePath();
                },
                placeholder: "~/.dsh/chat",
                style: {
                  width: "100%", boxSizing: "border-box",
                  marginTop: "4px", padding: "6px 10px",
                  fontSize: "12.5px", font: "inherit",
                  color: "var(--dsw-alias-label-primary, #f3f4f6)",
                  background: "var(--dsw-alias-bg-layer-1, #161616)",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  borderRadius: "8px",
                  opacity: writable ? 1 : 0.5,
                },
              }),
              jsx("span", {
                style: { fontSize: "12px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
                children: t("chatPathHint"),
              }),
            ],
          }),
          jsx("button", {
            type: "button",
            disabled: !writable || !pathDirty || saving,
            onClick: savePath,
            style: {
              marginTop: "22px", flexShrink: 0,
              padding: "6px 14px", borderRadius: "8px",
              fontSize: "12.5px", font: "inherit", cursor: "pointer",
              color: "var(--dsw-alias-label-primary-inverted, #fff)",
              background: "var(--dsw-alias-brand-primary, #2563eb)",
              border: "1px solid transparent",
              opacity: writable && pathDirty && !saving ? 1 : 0.5,
            },
            children: t("chatPathSave"),
          }),
        ],
      });

      /** Shared text styles for the model-capability group. */
      const modelsLabelStyle = {
        fontSize: "13.5px", fontWeight: 500,
        color: "var(--dsw-alias-label-primary, #f3f4f6)",
      };
      const modelsHintStyle = {
        fontSize: "12px", lineHeight: 1.5,
        color: "var(--dsw-alias-label-tertiary, #9ca3af)",
      };
      const modelsInputStyle = {
        width: "100%", boxSizing: "border-box",
        marginTop: "4px", padding: "6px 10px",
        fontSize: "12.5px", font: "inherit",
        color: "var(--dsw-alias-label-primary, #f3f4f6)",
        background: "var(--dsw-alias-bg-layer-1, #161616)",
        border: "1px solid var(--dsw-alias-border-l2, #333)",
        borderRadius: "8px",
      };
      const modelsButtonStyle = {
        padding: "6px 14px", borderRadius: "8px",
        fontSize: "12.5px", font: "inherit", cursor: "pointer",
        color: "var(--dsw-alias-label-primary-inverted, #fff)",
        background: "var(--dsw-alias-brand-primary, #2563eb)",
        border: "1px solid transparent",
      };

      /** A labelled model-capability input row (label, input, hint). */
      const modelsField = (label, hint, props) => jsxs("label", {
        style: { display: "flex", flexDirection: "column", gap: "3px" },
        children: [
          jsx("span", { style: modelsLabelStyle, children: label }),
          jsx("input", {
            spellCheck: false,
            autoComplete: "off",
            disabled: !writable || saving,
            ...props,
            style: { ...modelsInputStyle, opacity: writable ? 1 : 0.5 },
          }),
          jsx("span", { style: modelsHintStyle, children: hint }),
        ],
      });

      /**
       * The modelCapability group: the API key field, the two forced-modality
       * pickers, and a save button. There is deliberately no "sync model list"
       * button here — the POST route stays API/script-only; adopting new models
       * goes through dsh's own 「获取可用模型」 flow.
       */
      const modelsGroup = jsxs("div", {
        style: {
          display: "flex", flexDirection: "column", gap: "10px",
          padding: "10px 16px 14px",
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
        },
        children: [
          jsxs("div", {
            style: { display: "flex", flexDirection: "column", gap: "3px" },
            children: [
              jsx("span", { style: modelsLabelStyle, children: t("modelsInfoTitle") }),
              jsx("span", {
                style: modelsHintStyle,
                children: t("modelsInfoDesc", { route: value.modelsRouteKey || "opencode-go" }),
              }),
            ],
          }),
          modelsField(t("modelsKeyLabel"), t("modelsKeyHint", {
            env: value.modelsApiKeyEnvVar || "OPENCODE_API_KEY",
          }), {
            type: "password",
            placeholder: t("modelsKeyPlaceholder"),
            value: modelsKeyDraft,
            onChange: (event) => {
              setModelsKeyDraft(event.target.value);
              setModelsDirty(true);
            },
          }),
          jsx(ModelIdPicker, {
            t,
            label: t("modelsVisionLabel"),
            hint: t("modelsVisionHint"),
            values: modelsVisionDraft,
            options: modelOptions,
            optionsError: modelOptionsError,
            disabled: !writable || saving,
            query: visionQuery,
            onQuery: setVisionQuery,
            open: pickerFor === "vision",
            onOpen: (next) => setPickerFor(next ? "vision" : null),
            onAdd: addVisionId,
            onRemove: removeVisionId,
          }, "vision"),
          jsx(ModelIdPicker, {
            t,
            label: t("modelsTextOnlyLabel"),
            hint: t("modelsTextOnlyHint"),
            values: modelsTextOnlyDraft,
            options: modelOptions,
            optionsError: modelOptionsError,
            disabled: !writable || saving,
            query: textOnlyQuery,
            onQuery: setTextOnlyQuery,
            open: pickerFor === "textOnly",
            onOpen: (next) => setPickerFor(next ? "textOnly" : null),
            onAdd: addTextOnlyId,
            onRemove: removeTextOnlyId,
          }, "textOnly"),
          jsx("div", {
            style: { display: "flex", justifyContent: "flex-end" },
            children: jsx("button", {
              type: "button",
              disabled: !writable || !modelsDirty || saving,
              onClick: saveModels,
              style: {
                ...modelsButtonStyle,
                opacity: writable && modelsDirty && !saving ? 1 : 0.5,
              },
              children: t("modelsSave"),
            }),
          }),
        ],
      });

      /** One optimization's modal body: its switch plus option-specific fields. */
      const settingsFor = (opt) => [
        switchRow(opt),
        ...(opt.key === "workspacelessChat" ? [chatPathGroup] : []),
        ...(opt.key === "modelCapability" ? [modelsGroup] : []),
        ...(opt.key === "slashI18n" ? [jsx(SlashI18nManager, { t, writable, onClose: () => setModalOpt(null) })] : []),
        ...(error !== null ? [jsx("div", {
          style: {
            padding: "0 16px 12px",
            fontSize: "12.5px",
            color: "var(--dsw-alias-state-error-primary, #ef4444)",
          },
          children: `${t("saveError")}: ${error}`,
        })] : []),
      ];

      /** One optimization sub-card in the expanded list: icon, title, subtitle. */
      const subCard = (opt) => {
        const on = opts[opt.key] === true;
        return jsx("button", {
          type: "button",
          onClick: () => { setError(null); setModalOpt(opt.key); },
          "aria-label": t(opt.titleKey),
          style: {
            width: "calc(50% - 4px)", boxSizing: "border-box",
            appearance: "none",
            font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
            display: "flex", alignItems: "center", gap: "10px",
            padding: "10px 12px", borderRadius: "10px",
            border: "1px solid var(--dsw-alias-border-l2, #333)",
            background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
            transition: "border-color .16s",
          },
          children: [
            jsx("span", {
              style: {
                flexShrink: 0,
                display: "inline-flex", alignItems: "center", justifyContent: "center",
                width: "32px", height: "32px", borderRadius: "9px",
                color: "var(--dsw-alias-label-primary, #f3f4f6)",
                background: "var(--dsw-alias-bg-base, #141414)",
                border: "1px solid var(--dsw-alias-border-l2, #333)",
              },
              children: jsx(opt.icon, {}),
            }),
            jsxs("span", {
              style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" },
              children: [
                jsxs("span", {
                  style: {
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    fontSize: "13px", fontWeight: 600, lineHeight: 1.4,
                    color: "var(--dsw-alias-label-primary, #f3f4f6)",
                  },
                  children: [jsx("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, children: t(opt.titleKey) }),
                    jsx("span", {
                      style: {
                        flexShrink: 0,
                        padding: "0 6px", borderRadius: "999px",
                        fontSize: "10.5px", lineHeight: 1.7,
                        color: on
                          ? "var(--dsw-alias-state-success-primary, #16a34a)"
                          : "var(--dsw-alias-label-tertiary, #9ca3af)",
                        background: on
                          ? "rgba(22, 163, 74, 0.12)"
                          : "var(--dsw-alias-bg-base, #141414)",
                        border: "1px solid " + (on
                          ? "rgba(22, 163, 74, 0.35)"
                          : "var(--dsw-alias-border-l2, #333)"),
                      },
                      children: on ? t("toggleOn") : t("toggleOff"),
                    })],
                }),
                jsx("span", {
                  style: {
                    fontSize: "11.5px", lineHeight: 1.5,
                    color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                    overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                  },
                  children: t(opt.shortKey),
                }),
              ],
            }),
          ],
        }, opt.key);
      };

      const expandedBody = jsx("div", {
        style: {
          display: "flex", flexDirection: "column", gap: "8px",
          padding: "10px 12px 14px",
          borderTop: "1px solid var(--dsw-alias-border-l2, #333)",
        },
        children: [
          OPTIMIZATIONS.length > 1 ? jsxs("div", {
            style: {
              display: "flex", justifyContent: "flex-end", gap: "8px",
              paddingBottom: "2px",
            },
            children: [
              jsx("button", {
                type: "button",
                disabled: !writable || saving,
                onClick: () => { void setAll(true); },
                style: {
                  padding: "3px 10px", borderRadius: "8px", fontSize: "11.5px",
                  font: "inherit", cursor: "pointer",
                  color: "var(--dsw-alias-label-secondary, #d1d5db)",
                  background: "none",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  opacity: writable && !saving ? 1 : 0.5,
                },
                children: t("quickOn"),
              }),
              jsx("button", {
                type: "button",
                disabled: !writable || saving,
                onClick: () => { void setAll(false); },
                style: {
                  padding: "3px 10px", borderRadius: "8px", fontSize: "11.5px",
                  font: "inherit", cursor: "pointer",
                  color: "var(--dsw-alias-label-secondary, #d1d5db)",
                  background: "none",
                  border: "1px solid var(--dsw-alias-border-l2, #333)",
                  opacity: writable && !saving ? 1 : 0.5,
                },
                children: t("quickOff"),
              }),
            ],
          }) : null,
          jsx("div", {
            style: { display: "flex", flexWrap: "wrap", gap: "8px" },
            children: OPTIMIZATIONS.map(subCard),
          }),
        ],
      });

      return jsxs(React.Fragment, {
        children: [
          jsx("li", {
            style: {
              listStyle: "none",
              border: "1px solid " + (expanded
                ? "var(--dsw-alias-label-dimmed, #4b5563)"
                : "var(--dsw-alias-border-l2, #333)"),
              borderRadius: "12px",
              background: expanded
                ? "var(--dsw-alias-bg-layer-2, #1e1e1e)"
                : "var(--dsw-alias-bg-layer-3, #242424)",
              transition: "border-color .16s, background .16s",
            },
            children: [
              jsx("button", {
                type: "button",
                onClick: () => { setExpanded(!expanded); },
                "aria-expanded": expanded,
                "aria-label": t("cardOpen"),
                style: {
                  width: "100%", appearance: "none", border: 0, background: "none",
                  font: "inherit", color: "inherit", textAlign: "left", cursor: "pointer",
                  display: "flex", alignItems: "center", gap: "12px",
                  padding: "14px 16px", borderRadius: "12px",
                },
                children: [
                  jsxs("span", {
                    style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "4px" },
                    children: [
                      jsxs("span", {
                        style: {
                          display: "inline-flex", alignItems: "center", gap: "8px",
                          fontSize: "15px", fontWeight: 600, lineHeight: 1.4,
                          color: "var(--dsw-alias-label-primary, #f3f4f6)",
                        },
                        children: [jsx(IconPersonalizationOutline16, {}), jsx("span", { children: t("cardTitle") })],
                      }),
                      jsxs("span", {
                        style: { fontSize: "13px", lineHeight: 1.5, color: "var(--dsw-alias-label-tertiary, #9ca3af)" },
                        children: [t("cardDesc"), statusLine !== "" ? ` · ${statusLine}` : ""],
                      }),
                    ],
                  }),
                  jsxs("span", {
                    style: {
                      flexShrink: 0,
                      display: "inline-flex", alignItems: "center", gap: "10px",
                    },
                    children: [
                      jsxs("span", {
                        style: {
                          display: "inline-flex", alignItems: "center", gap: "6px",
                          padding: "2px 10px", borderRadius: "999px",
                          fontSize: "12px", lineHeight: 1.6,
                          color: enabledCount > 0
                            ? "var(--dsw-alias-state-success-primary, #16a34a)"
                            : "var(--dsw-alias-label-tertiary, #9ca3af)",
                          background: enabledCount > 0
                            ? "rgba(22, 163, 74, 0.12)"
                            : "rgba(148, 163, 184, 0.14)",
                          border: "1px solid " + (enabledCount > 0
                            ? "rgba(22, 163, 74, 0.25)"
                            : "var(--dsw-alias-border-l2, #333)"),
                        },
                        children: [
                          jsx("span", {
                            style: {
                              width: 6, height: 6, borderRadius: "50%",
                              background: enabledCount > 0
                                ? "var(--dsw-alias-state-success-primary, #16a34a)"
                                : "var(--dsw-alias-label-tertiary, #9ca3af)",
                              display: "inline-block",
                            },
                          }),
                          jsx("span", { children: t("cardStatus", { enabled: enabledCount, total: OPTIMIZATIONS.length }) }),
                        ],
                      }),
                      jsx(IconChevronDownOutline14, {
                        style: {
                          flex: "none",
                          color: "var(--dsw-alias-label-tertiary, #9ca3af)",
                          transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
                          transition: "transform .16s",
                        },
                      }),
                    ],
                  }),
                ],
              }),
              expanded ? expandedBody : null,
            ],
          }),
          activeOpt !== null ? jsx(Modal, {
            open: true,
            onClose: () => { setModalOpt(null); },
            title: t(activeOpt.titleKey),
            description: t(activeOpt.descKey),
            closeLabel: t("close"),
            className: activeOpt.key === "slashI18n" ? "tk-modal width tk-modal-slash-i18n" : "tk-modal width",
            footer: activeOpt.key === "slashI18n" ? undefined : jsx("button", {
              type: "button",
              onClick: () => { setModalOpt(null); },
              style: {
                padding: "7px 18px", borderRadius: "8px",
                fontSize: "13px", font: "inherit", cursor: "pointer",
                color: "var(--dsw-alias-label-primary, #f3f4f6)",
                background: "var(--dsw-alias-bg-layer-2, #1e1e1e)",
                border: "1px solid var(--dsw-alias-border-l2, #333)",
              },
              children: t("done"),
            }),
            children: jsx("div", {
              style: { display: "flex", flexDirection: "column" },
              children: settingsFor(activeOpt),
            }),
          }) : null,
        ],
      });
    }

    // ── registration ──────────────────────────────────────────────────────────

    /**
     * Inject one stylesheet for pieces the component inline styles cannot
     * reach (the shared Modal's dialog width). Idempotent per page load.
     */
    function ensureStyles() {
      if (document.getElementById("tk-styles")) return;
      const style = document.createElement("style");
      style.id = "tk-styles";
      style.textContent = `
        /* Widen the Toolkit settings modal beyond the shared 380px dialog, and
           let the model-id pickers' overlays escape the card instead of being
           clipped by the dialog's own overflow: hidden. */
        .tk-modal.width {
          width: min(560px, calc(100vw - 32px)) !important;
          overflow: visible !important;
        }
        .tk-modal-slash-i18n {
          width: min(840px, calc(100vw - 32px)) !important;
          max-width: 840px !important;
        }
        /* Change report: the markdown code-block container recipe —
           markdown-code-block background, 12px radius, banner row on the
           banner background, mono body at the diff's 22px line height. The
           banner and the body share the same 14px horizontal padding so the
           header stat and the per-file stats right-align on one edge. */
        .tk-report-block {
          background: var(--dsw-alias-markdown-code-block);
          border-radius: 12px;
          overflow: hidden;
        }
        .tk-report-banner {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 9px 14px;
          background: var(--dsw-alias-markdown-code-block-banner);
          font: 11px/18px var(--dsw-font-family);
        }
        .tk-report-body {
          display: flex;
          flex-direction: column;
          padding: 8px 14px 10px;
          font: var(--dsw-font-markdown-code-block);
        }
        .tk-report-row {
          display: flex;
          align-items: center;
          min-height: 22px;
          border-radius: 4px;
          transition: background .12s;
        }
        .tk-report-row:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(148, 163, 184, 0.08)); }
        .tk-report-row .tk-report-dir { color: var(--dsw-alias-label-tertiary); }
        .tk-report-row .tk-report-base { color: var(--dsw-alias-label-primary); font-weight: 600; }
        .tk-report-row:hover .tk-report-dir { color: var(--dsw-alias-label-secondary); }
        .tk-report-row:hover .tk-report-path {
          text-decoration: underline dotted;
          text-decoration-color: var(--dsw-alias-label-tertiary);
          text-decoration-thickness: 1px;
          text-underline-offset: 3px;
        }
        .tk-report-num {
          font-family: var(--ds-font-family-code, ui-monospace, monospace);
          font-variant-numeric: tabular-nums;
          flex-shrink: 0;
        }

        /* Activity View Toggle Button in Sidebar Header — mirrors the native
           .iconButton geometry (28x28 circle, 16px glyph) so it sits
           indistinguishably in the header action cluster. */
        .tk-activity-btn {
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: 50%;
          corner-shape: round;
          padding: 0;
          background: transparent;
          cursor: pointer;
          color: var(--dsw-alias-label-secondary, #a7acb5);
          transition: all 150ms ease;
        }
        .tk-activity-btn:hover {
          color: var(--dsw-alias-label-primary, #f3f4f6);
          background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06));
        }
        .tk-activity-btn.active {
          color: var(--dsw-alias-state-business-primary, #3b82f6);
          background: var(--dsw-alias-interactive-bg-active, rgba(59, 130, 246, 0.12));
        }

        /* Collapsed rail: the 56px rail fits exactly one 36px control per row,
           so the activity button joins the rail rhythm — 36x36 box with an
           18px glyph, vertically stacked with the native add control (12px
           gap) on the same center axis as the shell's rail icons. */
        [class*="_rail"] [class*="_sectionHeader"] {
          height: auto;
        }
        [class*="_rail"] [class*="_headerActions"] {
          flex-direction: column;
          gap: 12px;
        }
        [class*="_rail"] .tk-activity-btn {
          width: 36px;
          height: 36px;
          color: var(--dsw-alias-label-primary, #f3f4f6);
        }
        [class*="_rail"] .tk-activity-btn svg {
          width: 18px;
          height: 18px;
        }
        [class*="_rail"] .tk-activity-btn.active {
          color: var(--dsw-alias-state-business-primary, #3b82f6);
        }

        /* Activity View Tree */
        .tk-activity-tree {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          position: relative;
          overflow-y: auto;
          margin-left: -4px;
          margin-right: var(--dsh-session-list-scrollbar-offset, 2px);
          padding-left: 4px;
          padding-right: calc(var(--dsh-session-list-edge-inset, 8px) - var(--dsh-session-list-scrollbar-offset, 2px));
        }
        .tk-activity-group {
          margin-bottom: 8px;
        }
        .tk-activity-label {
          display: flex;
          align-items: center;
          margin-top: 8px;
          padding: 6px 12px 2px 28px;
          font-size: 12px;
          line-height: 18px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: var(--dsw-alias-label-tertiary, #81858c);
          user-select: none;
        }
        .tk-activity-label-with-icon {
          padding-left: 8px;
        }
        .tk-activity-label-slot {
          width: 16px;
          height: 18px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-right: 4px;
        }
        .tk-label-spin {
          flex-shrink: 0;
          color: var(--dsw-alias-state-business-primary, #3b82f6);
          animation: tk-spin 0.9s linear infinite;
        }
        .tk-activity-group:first-child .tk-activity-label {
          margin-top: 0;
        }
        .tk-activity-row {
          display: flex;
          flex-direction: column;
          border-radius: 8px;
          padding: 5px 8px;
          cursor: pointer;
          user-select: none;
          color: var(--dsw-alias-label-primary, #f3f4f6);
          transition: background 120ms ease;
          min-height: 32px;
          box-sizing: border-box;
        }
        .tk-activity-row:hover {
          background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.06));
        }
        .tk-activity-row.selected {
          background: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.08));
        }
        .tk-activity-row-main {
          display: flex;
          align-items: center;
          width: 100%;
          min-width: 0;
          height: 22px;
        }
        .tk-activity-status-slot {
          flex: none;
          width: 16px;
          height: 16px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          margin-right: 6px;
          color: var(--dsw-alias-label-tertiary, #81858c);
        }
        .tk-activity-title {
          flex: 1;
          min-width: 0;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 13px;
          line-height: 20px;
        }
        .tk-activity-time {
          flex: none;
          font-size: 11px;
          line-height: 20px;
          margin-left: 6px;
          color: var(--dsw-alias-label-tertiary, #81858c);
        }
        .tk-activity-project-line {
          display: flex;
          align-items: center;
          gap: 4px;
          margin-left: 22px;
          margin-top: 2px;
          min-width: 0;
          color: var(--dsw-alias-label-tertiary, #81858c);
        }
        .tk-activity-project-label {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 11px;
          line-height: 14px;
        }
        .tk-running-spinner {
          width: 10px;
          height: 10px;
          border: 2px solid rgba(59, 130, 246, 0.3);
          border-top-color: var(--dsw-alias-state-business-primary, #3b82f6);
          border-radius: 50%;
          animation: tk-spin 0.8s linear infinite;
        }
        @keyframes tk-spin {
          to { transform: rotate(360deg); }
        }
        .tk-completed-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--dsw-alias-state-success, #10b981);
        }
        .tk-idle-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--dsw-alias-label-tertiary, #6b7280);
          opacity: 0.5;
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    /**
     * Register one slot entry, tolerating a duplicate.
     *
     * The slots store throws when the same key + priority registers twice.
     * Under Cordis that cannot normally happen (inject disposes before
     * re-running), but if it ever does, an unguarded throw aborts the rest of
     * this install path — silently leaving every later optimization unwired.
     * Returns the registration handle, or undefined when it was refused.
     */
    function safeSlotRegister(ctx, options, component) {
      try {
        return ctx.slots.register(options, component);
      } catch (error) {
        console.warn(`[toolkit] slot "${options.name}" registration skipped:`, error);
        return undefined;
      }
    }

    exports.inject = ["locale", "slots", "settingsScope"];    exports.apply = function apply(ctx) {
      ctx.locale.register(NS, { zh, en });
      localeFace = ctx.locale;
      ensureStyles();

      let scope;
      try {
        scope = ctx.settingsScope.bind({ namespace: NS });
      } catch {
        scope = undefined;
      }

      // Optimization wiring: the runtime faces arrive as services, so the
      // callback pattern waits for both instead of hard-failing the plugin.
      let sessionsService = undefined;
      ctx.inject(["workspaces", "sessions", "uiWorkspace"], (services) => {
        sessionsService = services?.sessions ?? services?.get?.("sessions");
        ctx.effect(
          () => installWorkspacelessChat(services, scope, ctx),
          "toolkit: workspaceless chat",
        );
        ctx.effect(
          () => installActivityView(services, scope, ctx),
          "toolkit: activity view",
        );
      });

      // slashI18n: wrap the remote namespace services so the '/' menu shows
      // Chinese descriptions. ctx.inject parks this callback until the
      // namespaces mount (they never do on a host without them, leaving the
      // optimization dormant instead of failing the plugin).
      ctx.inject(["remote.commands", "remote.skills"], (services) => {
        ctx.effect(
          () => installSlashI18n(services, scope),
          "toolkit: slashI18n",
        );
      });

      // changeReport: codex-style per-turn change report. The turn-data
      // accumulator waits for uiConversation (plus the remote faces backing
      // the folder-open capability probe); the tail slot joins the
      // first-accepting chain AHEAD of ui-deliverables with a superset card,
      // and declines entirely when the optimization is off or the turn had no
      // file mutations, leaving the stock tail untouched.
      changeReportRefs.scope = scope;
      ctx.inject(["uiConversation", "remote", "remote.session"], (services) => {
        if (!changeReportDefinitionRegistered) {
          changeReportDefinitionRegistered = true;
          services.uiConversation.events.register(changeReportDefinition);
        }
        changeReportRefs.remote = services.remote;
        let capabilityRevision = 0;
        let pendingCapability = undefined;
        const store = changeReportRefs.workspacePathOpen;
        const load = () => {
          if (pendingCapability !== undefined) return;
          const revision = capabilityRevision;
          const probe = services.remote.session.canOpenWorkspacePath()
            .then((result) => {
              if (revision === capabilityRevision) store.set(result.ok === true && result.value === true);
            })
            .finally(() => {
              if (pendingCapability === probe) pendingCapability = undefined;
            });
          pendingCapability = probe;
        };
        const ensure = () => {
          changeReportCapabilityRequested = true;
          if (store.getSnapshot() === undefined) load();
        };
        changeReportRefs.ensureWorkspacePathOpen = ensure;
        /**
         * Reveal one changed file in the host's file manager. This is the
         * `action: 'reveal'` arm of the host's own `session.openWorkspacePath`
         * — the previous implementation passed the sentinel "." to the chat's
         * file OPENER, which is a different capability that expects a file.
         * Best-effort: a failure only warns (the card has no error surface).
         */
        changeReportRefs.revealPath = (path) => {
          if (typeof path !== "string" || path === "") return;
          const sessionRemote = services.remote?.session;
          if (typeof sessionRemote?.openWorkspacePath !== "function") return;
          try {
            Promise.resolve(sessionRemote.openWorkspacePath({ path, action: "reveal" }))
              .catch((error) => { console.warn("[toolkit] reveal in folder failed:", error); });
          } catch (error) {
            console.warn("[toolkit] reveal in folder failed:", error);
          }
        };
        ctx.on("connection/reset", () => {
          capabilityRevision += 1;
          pendingCapability = undefined;
          store.set(undefined);
          // Root-call routing is per connection; stale ids from the previous
          // one can never settle again.
          reportRootCallTurns.clear();
          if (changeReportCapabilityRequested) load();
        });
      });
      ctx.slots.inject("conversation.chat.turnTail", function* () {
        const registration = safeSlotRegister(ctx,
          {
            name: "conversation.chat.turnTail",
            id: "dsh-plugin-toolkit",
            priority: REPORT_TAIL_PRIORITY,
            select: selectTurnChanges,
            locale: NS,
            registrant: "dsh-plugin-toolkit",
            inject: () => ({
              // The framework memoizes this factory's RESULT once per
              // registration (runInject caches it), so every cross-service
              // reference must be read through a function at call time. Reading
              // the value here froze it at first render: if the remote/session
              // services mounted later, `isLoopback` stayed false, the folder
              // button never appeared, and the edit pencil kept answering
              // "unsupported" until a full page reload.
              isLoopback: () => changeReportRefs.remote?.$host?.isLoopback === true,
              ensureWorkspacePathOpen: () => { changeReportRefs.ensureWorkspacePathOpen?.(); },
              revealPath: (path) => { changeReportRefs.revealPath?.(path); },
              hooks: { workspacePathOpen: changeReportRefs.workspacePathOpen },
            }),
          },
          TurnChangeReport,
        );
        if (registration !== undefined) yield registration;
      });

      // editLastMessage: shadow the stock `user` chat node renderer (priority
      // -1 renders over the stock 0) with a bubble that adds the edit action.
      // The slot is keyed by ChatNodeKind; only `user` is taken over so
      // steering / pending bubbles keep the stock renderer.
      ctx.slots.inject("conversation.chat.node", function* () {
        const registration = safeSlotRegister(ctx,
          {
            name: "conversation.chat.node",
            key: "user",
            priority: -1,
            // The plugin owns its chrome and copy: the renderer's `t` comes
            // from this package's locale namespace (bubble + edit strings).
            locale: NS,
            registrant: "dsh-plugin-toolkit",
            inject: () => ({
              editLast: {
                isEnabled: () => {
                  const snap = scope?.getSnapshot?.();
                  return snap?.status === "ready"
                    ? snap.value?.optimizations?.editLastMessage !== false
                    : true;
                },
                // Read through a getter for the same reason as the change
                // report's faces above: this object is built once, but the
                // sessions service may mount after it.
                get sessions() { return sessionsService; },
              },
            }),
          },
          ToolkitUserMessageNodeView,
        );
        if (registration !== undefined) yield registration;
      });

      // Settings card on the Plugins page.
      // DSH 0.1.6+ moved settings to the Plugins page:
      //   - `plugins.bundle.config` (key: 'dsh-plugin-toolkit') for bundle-level config
      //   - `plugins.row.config` (key: 'dsh-plugin-toolkit#toolkit') for row-level config
      // Older DSH (< 0.1.6) used `settings.plugin.item` in the Settings dialog.
      if (scope !== undefined) {
        const injectSettings = () => ({
          hooks: { toolkitSettings: scope },
          toolkitSet: (field, value) => scope.set(field, value),
          // Atomic multi-field write when the host scope exposes mutate().
          toolkitMutate: typeof scope.mutate === "function"
            ? (ops) => scope.mutate(ops)
            : undefined,
          toolkitModels: async () => {
            // The route is configurable server-side (modelsPath); read the
            // resolved value live and fall back to the shipped default.
            const snap = scope.getSnapshot?.();
            const configured = snap?.status === "ready" ? snap.value?.modelsPath : undefined;
            const path = typeof configured === "string" && configured !== ""
              ? configured
              : MODELS_PATH;
            const response = await fetch(path);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json();
          },
        });

        // 1. DSH 0.1.6+ Plugin Manager: bundle-level configuration
        ctx.slots.inject("plugins.bundle.config", function* () {
          const registration = safeSlotRegister(ctx,
            {
              name: "plugins.bundle.config",
              key: "dsh-plugin-toolkit",
              locale: NS,
              inject: injectSettings,
            },
            ToolkitSettingsCard,
          );
          if (registration !== undefined) yield registration;
        });

        // 2. DSH 0.1.6+ Plugin Manager: row-level configuration
        ctx.slots.inject("plugins.row.config", function* () {
          const registration = safeSlotRegister(ctx,
            {
              name: "plugins.row.config",
              key: "dsh-plugin-toolkit#toolkit",
              locale: NS,
              inject: injectSettings,
            },
            ToolkitSettingsCard,
          );
          if (registration !== undefined) yield registration;
        });

        // 3. Legacy DSH (< 0.1.6) Settings modal slot
        ctx.slots.inject("settings.plugin.item", function* () {
          const registration = safeSlotRegister(ctx,
            {
              name: "settings.plugin.item",
              key: "toolkit",
              id: "toolkit",
              order: 30,
              locale: NS,
              inject: injectSettings,
            },
            ToolkitSettingsCard,
          );
          if (registration !== undefined) yield registration;
        });
      } else {
        console.warn("[toolkit] settings scope unavailable; settings card skipped");
      }
    };

    return exports;
  },
});
