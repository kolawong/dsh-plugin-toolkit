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
 *     Clicking the card opens a modal listing every optimization with a live
 *     on/off toggle.
 */

window.__ModuleLoader__.load({
  id: "dsh-plugin-toolkit",
  factory: (require) => {
    const exports = {};
    const React = require("react");
    const { useState, useEffect, useRef } = React;
    const { jsx, jsxs } = require("react/jsx-runtime");
    const {
      Modal, IconChevronDownOutline14, projectUserText, JsonBlock,
      IconCopyOutline16, IconCheckOutline16, Tooltip,
      IconPersonalizationOutline16, IconNewChatOutline16, IconEditOutline16,
      IconClockOutline16, IconGlobeOutline14, diffTotals,
      IconBranchOutline16,
    } = require("@deepseek-ai/dsh-client-ui-primitives");

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
        void navigator.clipboard.writeText(text);
        setCopied(true);
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
            content: copied ? (t ? t("msgCopied") : "已复制") : (t ? t("msgCopy") : "复制"),
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
      statusEmpty: "",
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
      noOptimizations: "暂无优化项",
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
      optI18nTitle: "斜杠菜单中文描述",
      optI18nShort: "/ 菜单的命令与技能描述显示中文",
      optI18nDesc:
        "将「/」菜单里 host 返回的命令/技能英文描述按内置词典译为中文（仅界面显示，条目名与执行不变）。未收录的文案保持原文；dsh 更新改写文案后词典未命中会自动回退英文。仅在界面语言为中文时生效。",
      optReportTitle: "改动报告",
      optReportShort: "回合结束后汇总本轮文件改动",
      optReportDesc:
        "每回合结束后，若本轮有文件改动（edit / write / str_replace_editor），在回合尾部显示改动报告卡片：文件数与 +N -M 汇总、按文件行数清单（点击打开文件）、审核按钮弹出完整 diff。不追踪 bash 内的文件写入；不含撤销功能。",
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
      statusEmpty: "",
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
      noOptimizations: "No optimizations yet",
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
      optI18nTitle: "Chinese slash-menu descriptions",
      optI18nShort: "Show / menu command & skill descriptions in Chinese",
      optI18nDesc:
        "Translate the English descriptions the host returns for '/' menu commands and skills into Chinese via a built-in dictionary (display only; names and execution unchanged). Unlisted text stays as-is, and a dsh update that rewords a description falls back to English until the dictionary catches up. Applies only while the UI language is Chinese.",
      optReportTitle: "Change report",
      optReportShort: "Per-turn file-change summary at the turn tail",
      optReportDesc:
        "After each turn, if it changed files (edit / write / str_replace_editor), a codex-style report card renders at the turn tail: file count with +N -M totals, a per-file line-count list (click opens the file), and a Review button opening the full diff. bash-side file writes are not tracked; undo is out of scope.",
      reportTitle: "{count} files edited",
      reportTitleOne: "1 file edited",
      reportMore: "Show {count} more files",
      reportShowFolder: "Show in folder",
      reportOpenAria: "Open {name}",
    };

    // ── editLastMessage: edit the last user message and resend in place ──────

    /**
     * Extract the plain text and image references of a user message node's
     * content blocks (mirrors the stock bubble's contentParts read).
     */
    function userTextOf(content) {
      let text = "";
      const images = [];
      const rest = [];
      for (const block of content || []) {
        if (block?.type === "text" && typeof block.text === "string") text += block.text;
        else if (block?.type === "image" && block.attachment !== undefined) images.push({ attachment: block.attachment });
        else rest.push(block);
      }
      return { text, images, rest };
    }

    /**
     * User-message renderer for the editLastMessage optimization: shadows the
     * stock `user` node renderer (slot priority -1 vs stock 0) and renders the
     * bubble with this package's own chrome (inline styles over the shared CSS
     * variables), adding a pencil edit action to the actions row when this is
     * the LAST user message and the optimization is enabled. Clicking the
     * pencil turns the bubble into an inline editor — no modal.
     */
    function ToolkitUserMessageNodeView(props) {
      const { node, renderMessageImages, t, useChat, sessionId, editLast } = props;
      const data = node.data;
      const enabled = editLast?.isEnabled?.() !== false;
      const { text, images, rest } = userTextOf(data.content);
      const refs = data.referenceLabels ?? [];
      const truncated = (total) => t("msgTruncated", { total });
      const showBubble = text !== "" || rest.length > 0;
      // Only the LAST user message offers the edit action.
      const tailSeq = useChat((snapshot) => {
        let last = -1;
        for (const key of snapshot.order) {
          const candidate = snapshot.nodes.get(key);
          if (candidate?.kind === "user" && candidate.data.seq > last) last = candidate.data.seq;
        }
        return last;
      });
      const isTail = enabled && tailSeq === data.seq && text !== "";

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
              showBubble ? jsx("div", {
                style: bubbleStyle,
                children: [
                  projectUserText(text, refs),
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
    }

    // ── viewActivity: workspace-header activity toggle (in-sidebar re-sort) ──

    /**
     * The workspace-header action installed by the toolkit: a native clock
     * icon right after the search control. Toggling it re-sorts the browser's
     * own session list IN PLACE — running conversations first under the
     * Priority group, then history grouped by day (今天/昨天/星期X/更早).
     * The grouping is host-rendered (ui-workspace deriveActivity); this
     * component only toggles the mode and reflects the active state.
     */
    function WorkspaceActivityAction(props) {
      const { wide, t, activity, activityActive, onToggleActivity } = props;
      const enabled = activity?.isEnabled?.() !== false;
      if (!enabled) return null;
      const active = activityActive === true;
      return jsx(Tooltip, {
        label: t("activityOpen"),
        side: "bottom",
        delayMs: 500,
        children: jsx("button", {
          type: "button",
          "aria-label": t("activityOpen"),
          "aria-pressed": active,
          title: t("activityOpen"),
          onClick: () => { onToggleActivity?.(); },
          style: {
            flexShrink: 0,
            display: "inline-flex", alignItems: "center", justifyContent: "center",
            width: wide ? "28px" : "36px", height: wide ? "28px" : "36px",
            borderRadius: "50%", padding: 0, font: "inherit",
            color: active
              ? "var(--dsw-alias-state-business-primary, #2563eb)"
              : "var(--dsw-alias-label-secondary, #d1d5db)",
            background: "transparent", border: "none", cursor: "pointer",
          },
          onMouseEnter: (event) => { event.currentTarget.style.background = "var(--dsw-alias-interactive-bg-hover)"; },
          onMouseLeave: (event) => { event.currentTarget.style.background = "transparent"; },
          children: jsx(IconClockOutline16, { size: wide ? 16 : 18 }),
        }),
      });
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

    /** Symbol flags marking an already-wrapped namespace service method. */
    const SLASH_I18N_FLAG = Symbol.for("dsh-plugin-toolkit.slashI18n.wrapped");
    /** cordis exposes the raw service behind a traceable proxy under this symbol. */
    const CORDIS_ORIGINAL = Symbol.for("cordis.original");
    /** The locale service face, captured in apply (undefined before that). */
    let slashI18nLocaleFace = undefined;

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
      const active = slashI18nLocaleFace?.getSnapshot?.()?.active;
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
      const skills = value.skills.map((skill) => (
        skill !== null && typeof skill === "object"
          ? { ...skill, description: slashZhText(skill.description, scope) }
          : skill
      ));
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
     * @param {any} scope - settings scope captured for the rewriter.
     * @returns {boolean} whether the wrap took effect.
     */
    function wrapNamespaceMethod(service, method, rewrite, scope) {
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
                    return rewrite(result, scope);
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
      return true;
    }

    /**
     * Install the slashI18n optimization: wrap `remote.commands.list` and
     * `remote.skills.list` so the '/' menu shows Chinese descriptions. Both
     * namespaces arrive through ctx.inject, so an older host without them
     * simply never activates this optimization (the toolkit keeps loading).
     * @param {{ "remote.commands": any, "remote.skills": any }} services - namespace services.
     * @param {any} scope - bound settings scope, or undefined when unavailable.
     */
    function installSlashI18n(services, scope) {
      const commands = wrapNamespaceMethod(services["remote.commands"], "list", rewriteCommandsResult, scope);
      const skills = wrapNamespaceMethod(services["remote.skills"], "list", rewriteSkillsResult, scope);
      if (commands || skills) {
        console.info(`[toolkit] slashI18n installed (commands: ${commands}, skills: ${skills})`);
      } else {
        console.warn("[toolkit] slashI18n: no compatible remote namespace method found");
      }
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
    /** Faces captured in apply (factory-level, like slashI18nLocaleFace). */
    const changeReportRefs = { scope: undefined, remote: undefined, workspacePathOpen: makeTinyStore(undefined) };
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
     * mutations join the right turn's fold. Grows per page load (bounded by
     * session length); replay re-fills it deterministically.
     */
    const reportRootCallTurns = new Map();

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
          if (callId !== "") reportRootCallTurns.set(callId, state.turn);
          const calls = new Map(state.calls);
          calls.set(
            callId,
            reportMutationFromArgs(match.event.data.name, match.event.data.arguments),
          );
          return { ...state, calls };
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
      const hunks = Array.isArray(stored?.hunks) ? stored.hunks : [];
      const settled = hunks.filter((hunk) => hunk.seq <= owner.seq);
      if (settled.length === 0) return null;
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
        const part = diffTotals([{ path: hunk.path, oldText: hunk.oldText, newText: hunk.newText }]);
        file.added += part.added;
        file.removed += part.removed;
        file.hunks.push({ path: hunk.path, oldText: hunk.oldText, newText: hunk.newText });
        added += part.added;
        removed += part.removed;
      }
      return { files, added, removed };
    }

    /**
     * Codex-style change report card for one completed turn: aggregate
     * header, per-file rows with +/- counts (click opens the file), an
     * expander for long lists, and the folder-open capability the stock
     * produced-files tail carried.
     */
    function TurnChangeReport(props) {
      const { matched, openFile, isLoopback, ensureWorkspacePathOpen, useWorkspacePathOpen, t } = props;
      useEffect(() => { ensureWorkspacePathOpen?.(); }, [ensureWorkspacePathOpen]);
      const hostCanOpenPath = useWorkspacePathOpen?.((available) => available === true);
      const canOpenPath = isLoopback === true && hostCanOpenPath === true;
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
              const at = file.path.lastIndexOf("/");
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
            canOpenPath && files.length > 1 ? jsx("button", {
              type: "button",
              onClick: () => { openFile?.("."); },
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
    function installWorkspacelessChat({ workspaces, sessions }, scope) {
      let busy = false;
      let attempts = 0;
      let retryTimer = undefined;

      const readValue = () => {
        if (scope === undefined) return undefined;
        const snap = scope.getSnapshot?.();
        return snap?.status === "ready" ? snap.value : undefined;
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
        const chatPath = typeof value.chatWorkspacePath === "string"
          ? value.chatWorkspacePath.trim()
          : "";
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
          if (view === undefined) throw new Error("toolkit settings namespace not ready");
          const sessionId = await workspaces.connectWorkspace(view.workspaceId);
          attempts = 0;
          if (sessions.list.getSnapshot().current === undefined) {
            sessions.open(sessionId);
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
        if (retryTimer !== undefined) clearTimeout(retryTimer);
        stop1();
        stop2();
        stop3?.();
      };
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
      const { t, useToolkitSettings, toolkitSet } = props;
      const snap = typeof useToolkitSettings === 'function' ? useToolkitSettings((s) => s) : (typeof props.scope?.getSnapshot === 'function' ? props.scope.getSnapshot() : {});
      const value = snap.value ?? {};
      const writable = snap.writable === true;
      const opts = value.optimizations ?? {};

      const [expanded, setExpanded] = useState(false);
      const [modalOpt, setModalOpt] = useState(null);
      const [saving, setSaving] = useState(false);
      const [savedTick, setSavedTick] = useState(false);
      const [error, setError] = useState(null);
      const [pathDraft, setPathDraft] = useState("");
      const [pathDirty, setPathDirty] = useState(false);
      const pathInput = useRef(null);

      // Sync the directory draft from the live value until the user edits it.
      useEffect(() => {
        if (pathDirty) return;
        setPathDraft(typeof value.chatWorkspacePath === "string" ? value.chatWorkspacePath : "");
      }, [value.chatWorkspacePath, pathDirty]);

      const write = async (field, next) => {
        setSaving(true);
        setError(null);
        try {
          await toolkitSet(field, next);
          setSavedTick(true);
        } catch (cause) {
          setError(cause?.message ?? String(cause));
        } finally {
          setSaving(false);
        }
      };

      const toggle = (key, next) => write("optimizations", { ...opts, [key]: next });

      /** Enable or disable every optimization with one action. */
      const setAll = (on) => write(
        "optimizations",
        Object.fromEntries(OPTIMIZATIONS.map((opt) => [opt.key, on])),
      );

      const savePath = () => {
        setPathDirty(false);
        void write("chatWorkspacePath", pathDraft.trim());
      };

      const enabledCount = OPTIMIZATIONS.filter((opt) => opts[opt.key] === true).length;
      const activeOpt = modalOpt === null ? null : OPTIMIZATIONS.find((opt) => opt.key === modalOpt);
      const statusLine =
        snap.mode === "memory"
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

      /** One optimization's modal body: its switch plus option-specific fields. */
      const settingsFor = (opt) => [
        switchRow(opt),
        ...(opt.key === "workspacelessChat" ? [chatPathGroup] : []),
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
          onClick: () => { setModalOpt(opt.key); },
          "aria-label": t(opt.titleKey),
          style: {
            width: "calc(50% - 4px)", boxSizing: "border-box",
            appearance: "none", border: 0, background: "none",
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
            className: "tk-modal width",
            footer: jsx("button", {
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
        /* Widen the Toolkit settings modal beyond the shared 380px dialog. */
        .tk-modal.width {
          width: min(560px, calc(100vw - 32px)) !important;
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
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    exports.inject = ["locale", "slots", "settingsScope"];
    exports.apply = function apply(ctx) {
      ctx.locale.register(NS, { zh, en });
      slashI18nLocaleFace = ctx.locale;
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
      ctx.inject(["workspaces", "sessions"], (services) => {
        sessionsService = services.sessions;
        ctx.effect(
          () => installWorkspacelessChat(services, scope),
          "toolkit: workspaceless chat",
        );
      });

      // slashI18n: wrap the remote namespace services so the '/' menu shows
      // Chinese descriptions. ctx.inject parks this callback until the
      // namespaces mount (they never do on a host without them, leaving the
      // optimization dormant instead of failing the plugin).
      ctx.inject(["remote.commands", "remote.skills"], (services) => {
        installSlashI18n(services, scope);
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
        ctx.on("connection/reset", () => {
          capabilityRevision += 1;
          pendingCapability = undefined;
          store.set(undefined);
          if (changeReportCapabilityRequested) load();
        });
      });
      ctx.slots.inject("conversation.chat.turnTail", function* () {
        yield ctx.slots.register(
          {
            name: "conversation.chat.turnTail",
            priority: REPORT_TAIL_PRIORITY,
            select: selectTurnChanges,
            locale: NS,
            registrant: "dsh-plugin-toolkit",
            inject: () => ({
              isLoopback: changeReportRefs.remote?.$host?.isLoopback === true,
              ensureWorkspacePathOpen: changeReportRefs.ensureWorkspacePathOpen,
              hooks: { workspacePathOpen: changeReportRefs.workspacePathOpen },
            }),
          },
          TurnChangeReport,
        );
      });

      // editLastMessage: shadow the stock `user` chat node renderer (priority
      // -1 renders over the stock 0) with a bubble that adds the edit action.
      // The slot is keyed by ChatNodeKind; only `user` is taken over so
      // steering / pending bubbles keep the stock renderer.
      ctx.slots.inject("conversation.chat.node", function* () {
        yield ctx.slots.register(
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
                sessions: sessionsService,
              },
            }),
          },
          ToolkitUserMessageNodeView,
        );
      });

      // viewActivity: an activity toggle icon after the sidebar's search
      // control. The host declares `sidebar.workspaces.actions` (ui-workspace
      // browser) and hands each action the activity face (activityActive +
      // onToggleActivity) through the owner props; this package registers the
      // icon here. The grouping itself is host-rendered, so the inject face
      // only carries the live enable check.
      ctx.slots.inject("sidebar.workspaces.actions", function* () {
        yield ctx.slots.register(
          {
            name: "sidebar.workspaces.actions",
            id: "dsh-plugin-toolkit.activity",
            priority: 0,
            locale: NS,
            registrant: "dsh-plugin-toolkit",
            inject: () => ({
              activity: {
                isEnabled: () => {
                  const snap = scope?.getSnapshot?.();
                  return snap?.status === "ready"
                    ? snap.value?.optimizations?.viewActivity !== false
                    : true;
                },
              },
            }),
          },
          WorkspaceActivityAction,
        );
      });

      // Settings card on the Plugins page. The slot entry's key must equal
      // the registered settings namespace: the plugins page pairs cards to
      // namespaces by this exact string.
      if (scope !== undefined) {
        ctx.slots.inject("settings.plugin.item", function* () {
          yield ctx.slots.register(
            {
              name: "settings.plugin.item",
              key: "toolkit",
              id: "toolkit",
              order: 30,
              locale: NS,
              inject: () => ({
                hooks: { toolkitSettings: scope },
                toolkitSet: (field, value) => scope.set(field, value),
              }),
            },
            ToolkitSettingsCard,
          );
        });
      } else {
        console.warn("[toolkit] settings scope unavailable; settings card skipped");
      }
    };

    return exports;
  },
});
