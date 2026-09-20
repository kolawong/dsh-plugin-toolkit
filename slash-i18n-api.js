/**
 * dsh-plugin-toolkit - slash-i18n-api
 *
 * Backend support for Slash Menu Chinese I18n:
 *  - Reads existing credentials (DEEPSEEK_API_KEY, ARK_API_KEY) from ~/.dsh/.credentials.yaml
 *  - Persists custom and AI-generated translations to ~/.dsh/toolkit-slash-translations.json
 *  - Exposes REST routes via webServer:
 *      GET  /api/toolkit/slash-translations
 *      POST /api/toolkit/slash-translations
 *      POST /api/toolkit/translate-slash
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

function getDshHome() {
  return process.env.DSH_HOME || join(homedir(), ".dsh");
}

function getTranslationsFilePath() {
  return join(getDshHome(), "toolkit-slash-translations.json");
}

/**
 * Safely parse credentials from ~/.dsh/.credentials.yaml or process.env
 */
export function resolveCredentials() {
  const credPath = join(getDshHome(), ".credentials.yaml");
  const creds = {};

  try {
    if (existsSync(credPath)) {
      const content = readFileSync(credPath, "utf8");
      const regex = /([A-Za-z0-9_]+)\s*:\s*([^,\r\n}]+)/g;
      let match;
      while ((match = regex.exec(content)) !== null) {
        const key = match[1].trim();
        const val = match[2].trim().replace(/^["'\s]+|["'\s]+$/g, "");
        if (key && val && key !== "version" && key !== "kind" && key !== "secret") {
          creds[key] = val;
        }
      }
    }
  } catch (err) {
    // ignore read error
  }

  for (const envKey of ["DEEPSEEK_API_KEY", "ARK_API_KEY", "OPENCODE_GO_API_KEY", "MINIMAX_CN_API_KEY", "KIMI_CODING_API_KEY"]) {
    if (process.env[envKey] && !creds[envKey]) {
      creds[envKey] = process.env[envKey];
    }
  }

  return creds;
}

/**
 * Scan filesystem for skills on disk (e.g. Hindsight, ~/.dsh/skills)
 */
function scanDiskSkills() {
  const results = [];
  const candidates = [
    join(homedir(), ".hindsight", "coding-agents", "skill", "SKILL.md"),
  ];

  const dshSkillsDir = join(getDshHome(), "skills");
  if (existsSync(dshSkillsDir)) {
    try {
      const entries = readdirSync(dshSkillsDir);
      for (const entry of entries) {
        candidates.push(join(dshSkillsDir, entry, "SKILL.md"));
      }
    } catch {}
  }

  for (const file of candidates) {
    try {
      if (existsSync(file)) {
        const content = readFileSync(file, "utf8");
        const matchName = content.match(/^name:\s*(.+)$/m);
        const matchDesc = content.match(/^description:\s*(.+)$/m);
        if (matchName && matchDesc) {
          results.push({
            name: matchName[1].trim(),
            description: matchDesc[1].trim(),
            type: "skill",
            source: "disk",
          });
        }
      }
    } catch {}
  }
  return results;
}

/**
 * Read saved custom translations from disk.
 */
export function loadSavedData(customPath) {
  const file = customPath || getTranslationsFilePath();
  if (!existsSync(file)) {
    return { translations: {}, discovered: [] };
  }
  try {
    const raw = readFileSync(file, "utf8");
    const data = JSON.parse(raw);
    return {
      translations: data.translations || {},
      discovered: Array.isArray(data.discovered) ? data.discovered : [],
    };
  } catch (err) {
    return { translations: {}, discovered: [] };
  }
}

/**
 * Save custom translations to disk.
 */
export function saveTranslationsData(data, customPath) {
  const file = customPath || getTranslationsFilePath();
  const payload = {
    version: 1,
    updatedAt: new Date().toISOString(),
    translations: data.translations || {},
    discovered: Array.isArray(data.discovered) ? data.discovered : [],
  };
  writeFileSync(file, JSON.stringify(payload, null, 2), "utf8");
}

/**
 * Call AI API to translate descriptions to Chinese.
 */

function extractJsonFromContent(content) {
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {}
  const matchFence = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (matchFence) {
    try {
      return JSON.parse(matchFence[1]);
    } catch {}
  }
  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(content.slice(firstBrace, lastBrace + 1));
    } catch {}
  }
  return null;
}

function normalizeTranslations(rawTranslations, items) {
  if (!rawTranslations || typeof rawTranslations !== "object") return {};
  const result = {};
  for (const item of items) {
    const text = item.text || "";
    const name = item.name || "";
    if (rawTranslations[text]) {
      result[text] = rawTranslations[text];
    } else if (name && rawTranslations[name]) {
      result[text] = rawTranslations[name];
    } else {
      const foundKey = Object.keys(rawTranslations).find(
        (k) => k === text || (text && k.includes(text.slice(0, 30))) || (name && k === name)
      );
      if (foundKey) {
        result[text] = rawTranslations[foundKey];
      }
    }
  }
  if (items.length === 1 && items[0].text && Object.keys(result).length === 0) {
    const firstVal = Object.values(rawTranslations)[0];
    if (typeof firstVal === "string") {
      result[items[0].text] = firstVal;
    }
  }
  return { ...rawTranslations, ...result };
}

export async function callAiTranslate(items, creds, mode = "translate") {
  const deepseekKey = creds.DEEPSEEK_API_KEY;
  const arkKey = creds.ARK_API_KEY;

  if (!deepseekKey && !arkKey) {
    throw new Error("未检测到已配置的 AI Key (DEEPSEEK_API_KEY 或 ARK_API_KEY)");
  }

  const promptItems = items.map((it) => ({
    name: it.name || "",
    text: it.text || "",
  }));

  const isOptimize = mode === "optimize" || mode === "summarize";
  const systemPrompt = isOptimize
    ? `你是一个专业的 IDE 斜杠命令菜单文案专家。
任务：对用户输入的命令/技能条目提取核心功能，输出 10 到 25 个汉字的高信息密度中文短语。禁止逐句直译，禁止展开细节、枚举或前缀废话。
严格以 JSON 输出：
{
  "translations": {
    "<原英文文案>": "<10-25字精简归纳中文>"
  }
}`
    : `你是一个专业的软件工具与 IDE 菜单本地化专家。
任务：将用户提供的斜杠命令与技能描述翻译为准确、地道、简洁的中文（通常 6 到 22 个汉字），适合斜杠命令弹出菜单。
保持行业标准技术术语（如 ZIP、JSON、Git、API、Hindsight、taskctl 等）。
严格以 JSON 输出：
{
  "translations": {
    "<原英文文案>": "<中文翻译>"
  }
}`;

  const userContent = isOptimize
    ? `请将以下条目翻译并【精简归纳为 10-25 个汉字的一句话短语】（切勿完整直译，必须提炼核心功能与触发时机）：\n` + JSON.stringify(promptItems, null, 2)
    : `请将以下命令/技能文案翻译为地道简洁中文：\n` + JSON.stringify(promptItems, null, 2);

  // 1. Try DeepSeek first
  if (deepseekKey) {
    try {
      const resp = await fetch("https://api.deepseek.com/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${deepseekKey}`,
        },
        body: JSON.stringify({
          model: "deepseek-chat",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userContent },
          ],
          response_format: { type: "json_object" },
          temperature: 0.1,
        }),
      });

      if (resp.ok) {
        const result = await resp.json();
        const content = result.choices?.[0]?.message?.content;
        const parsed = extractJsonFromContent(content);
        if (parsed && typeof parsed.translations === "object") {
          return normalizeTranslations(parsed.translations, promptItems);
        }
      } else {
        const errText = await resp.text();
        console.warn("[toolkit] DeepSeek translate HTTP error:", resp.status, errText);
      }
    } catch (err) {
      console.warn("[toolkit] DeepSeek translate call error:", err);
    }
  }

  // 2. Fallback to Ark (try glm-5.3-flash, glm-latest, deepseek-v4-flash-ga-260731)
  if (arkKey) {
    const arkModels = ["glm-5.3-flash", "glm-latest", "deepseek-v4-flash-ga-260731"];
    for (const model of arkModels) {
      try {
        const resp = await fetch("https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${arkKey}`,
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
            response_format: { type: "json_object" },
            temperature: 0.1,
          }),
        });

        if (resp.ok) {
          const result = await resp.json();
          const content = result.choices?.[0]?.message?.content;
          const parsed = extractJsonFromContent(content);
          if (parsed && typeof parsed.translations === "object") {
            return normalizeTranslations(parsed.translations, promptItems);
          }
        } else {
          const errText = await resp.text();
          console.warn(`[toolkit] Ark translate (${model}) HTTP error:`, resp.status, errText);
        }
      } catch (err) {
        console.warn(`[toolkit] Ark translate (${model}) call error:`, err);
      }
    }
  }

  throw new Error("AI 翻译请求失败，请检查网络连接或 API Key 状态");
}

function sendJson(res, body, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error("Invalid JSON payload"));
      }
    });
    req.on("error", reject);
  });
}

/**
 * Install slash-i18n API routes on hostCtx.
 */
export function installSlashI18nApi(hostCtx, logger) {
  hostCtx.inject(["webServer"], (sctx) => {
    // 1. GET /api/toolkit/slash-translations
    //    POST /api/toolkit/slash-translations
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: "/api/toolkit/slash-translations",
          handler: async (req, res) => {
            if (req.method === "GET") {
              try {
                const saved = loadSavedData();
                const diskSkills = scanDiskSkills();
                // Merge disk skills into discovered list
                const discoveredMap = new Map();
                for (const d of saved.discovered) {
                  if (d && d.name) discoveredMap.set(d.name, d);
                }
                for (const ds of diskSkills) {
                  if (!discoveredMap.has(ds.name)) {
                    discoveredMap.set(ds.name, ds);
                  }
                }
                sendJson(res, {
                  ok: true,
                  translations: saved.translations,
                  discovered: Array.from(discoveredMap.values()),
                });
              } catch (err) {
                sendJson(res, { ok: false, error: err.message }, 500);
              }
              return;
            }

            if (req.method === "POST") {
              try {
                const body = await readBody(req);
                const current = loadSavedData();
                const updatedTranslations = {
                  ...current.translations,
                  ...(body.translations || {}),
                };
                // merge discovered
                const discoveredMap = new Map();
                for (const d of current.discovered) {
                  if (d && d.name) discoveredMap.set(d.name, d);
                }
                if (Array.isArray(body.discovered)) {
                  for (const d of body.discovered) {
                    if (d && d.name) discoveredMap.set(d.name, d);
                  }
                }
                saveTranslationsData({
                  translations: updatedTranslations,
                  discovered: Array.from(discoveredMap.values()),
                });
                sendJson(res, { ok: true, message: "Saved successfully" });
              } catch (err) {
                sendJson(res, { ok: false, error: err.message }, 500);
              }
              return;
            }

            sendJson(res, { ok: false, error: "Method Not Allowed" }, 405);
          },
        }),
      "toolkit: /api/toolkit/slash-translations route",
    );

    // 2. POST /api/toolkit/translate-slash
    sctx.effect(
      () =>
        sctx.webServer.register({
          kind: "exact",
          path: "/api/toolkit/translate-slash",
          handler: async (req, res) => {
            if (req.method !== "POST") {
              sendJson(res, { ok: false, error: "Method Not Allowed" }, 405);
              return;
            }
            try {
              const body = await readBody(req);
              const items = Array.isArray(body.items) ? body.items : [];
              if (items.length === 0) {
                sendJson(res, { ok: true, translations: {} });
                return;
              }
              const creds = resolveCredentials();
              const mode = body.mode === "optimize" || body.mode === "summarize" ? "optimize" : "translate";
              const translations = await callAiTranslate(items, creds, mode);
              sendJson(res, { ok: true, translations });
            } catch (err) {
              sendJson(res, { ok: false, error: err.message }, 500);
            }
          },
        }),
      "toolkit: /api/toolkit/translate-slash route",
    );

    logger?.info?.("[toolkit] slash-i18n API routes registered");
  });
}
