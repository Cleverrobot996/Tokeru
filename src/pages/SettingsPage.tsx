import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Copy, Database, Eye, Globe, KeyRound, Loader2, Palette, Plug, Plus, RefreshCw, Save, Sparkles, Timer, Type, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "../lib/api";
import type { AiProvider, AppSettings, McpStatus } from "../lib/types";
import { useTheme, type Accent, type ThemeMode } from "../lib/theme";
import { Button, Chip, Field, Modal, Switch } from "../components/ui";
import { PaperSettings } from "../components/PaperSettings";
import { loadPaperStyle, savePaperStyle, type PaperStyle } from "../lib/paper";

type Endpoint = "none" | AiProvider;

const ENDPOINTS: { value: Endpoint; label: string; base: string; model: string }[] = [
  { value: "none", label: "不用 AI", base: "", model: "" },
  { value: "deepseek", label: "DeepSeek", base: "https://api.deepseek.com", model: "deepseek-chat" },
  { value: "openai", label: "OpenAI 兼容", base: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  { value: "anthropic", label: "Anthropic 兼容", base: "https://api.anthropic.com", model: "claude-sonnet-4-5" },
  { value: "ollama", label: "本地 Ollama", base: "http://127.0.0.1:11434/v1", model: "qwen2.5:7b" },
  { value: "dashscope", label: "阿里云百炼", base: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
];

const ACCENTS: { value: Accent; label: string }[] = [
  { value: "violet", label: "鸢尾" },
  { value: "teal", label: "青瓷" },
  { value: "amber", label: "琥珀" },
  { value: "rose", label: "胭脂" },
  { value: "slate", label: "青灰" },
];

const THEMES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

function endpointOf(base: string): Endpoint {
  const b = base.trim().toLowerCase();
  if (!b) return "none";
  if (b.includes("api.openai.com")) return "openai";
  if (b.includes("deepseek.com")) return "deepseek";
  if (b.includes("anthropic.com")) return "anthropic";
  if (b.includes("dashscope.aliyuncs.com")) return "dashscope";
  if (b.includes("127.0.0.1") || b.includes("localhost") || b.includes("0.0.0.0")) return "ollama";
  return "openai";
}

function isLocalEndpoint(base: string) {
  const b = base.trim().toLowerCase();
  return b.includes("127.0.0.1") || b.includes("localhost") || b.includes("0.0.0.0") || b.includes("::1");
}

/* 后端把服务端原文放在错误里；Tauri invoke 失败时可能抛字符串，也可能抛 Error，统一成正文。 */
function errText(e: unknown) {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : String(e);
  return raw.replace(/^Error:\s*/i, "").trim() || "未知错误";
}

export default function SettingsPage() {
  const { theme, accent, setAccent, setTheme } = useTheme();
  const q = useQuery({ queryKey: ["settings"], queryFn: api.getSettings });
  const qc = useQueryClient();
  const [form, setForm] = useState({
    apiKey: "",
    clearKey: false,
    hasKey: false,
    model: "",
    baseUrl: "",
    provider: "" as AiProvider | "",
    visionModel: "",
    visionBaseUrl: "",
    thinkingOrganize: false,
    thinkingVision: false,
    thinkingExplain: false,
    prompt: "",
    presets: [] as number[],
    defaultTimer: 0,
  });
  const [endpoint, setEndpoint] = useState<Endpoint>("none");
  const [models, setModels] = useState<{ chat: string[]; vision: string[] }>({ chat: [], vision: [] });
  const [listing, setListing] = useState<"chat" | "vision" | null>(null);
  const [modelMenu, setModelMenu] = useState<"chat" | "vision" | null>(null);
  const [presetInput, setPresetInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<"chat" | "vision" | null>(null);
  /* 仅限本次会话：记录刚测试通过的模型名，不落库。 */
  const [tested, setTested] = useState<{ chat: string | null; vision: string | null }>({ chat: null, vision: null });
  const [backing, setBacking] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [backups, setBackups] = useState<string[]>([]);
  const [backupsBusy, setBackupsBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [paper, setPaper] = useState<PaperStyle>(() => loadPaperStyle());
  const [mcp, setMcp] = useState<McpStatus | null>(null);
  const [mcpPort, setMcpPort] = useState("17890");
  const [mcpReadonly, setMcpReadonly] = useState(true);
  const [mcpBusy, setMcpBusy] = useState(false);
  const [mcpCopied, setMcpCopied] = useState("");

  useEffect(() => {
    if (!q.data) return;
    const s: AppSettings = q.data;
    setForm({
      apiKey: "",
      clearKey: false,
      hasKey: s.has_api_key,
      model: s.model ?? "",
      baseUrl: s.base_url ?? "",
      provider: s.provider ?? "",
      visionModel: s.vision_model ?? "",
      visionBaseUrl: s.vision_base_url ?? "",
      thinkingOrganize: s.thinking_organize ?? false,
      thinkingVision: s.thinking_vision ?? false,
      thinkingExplain: s.thinking_explain ?? false,
      prompt: s.custom_prompt ?? "",
      presets: (s.timer_presets ?? []).filter((m) => Number.isFinite(m) && m > 0),
      defaultTimer: s.default_timer ?? 0,
    });
    setEndpoint(s.provider || endpointOf(s.base_url ?? ""));
  }, [q.data]);

  /* 地址、模型或 Key 一改动，上一次的「已连接」就不再可信。 */
  useEffect(() => {
    setTested({ chat: null, vision: null });
  }, [
    form.baseUrl,
    form.model,
    form.visionBaseUrl,
    form.visionModel,
    form.apiKey,
    form.provider,
    form.thinkingOrganize,
    form.thinkingVision,
    form.thinkingExplain,
    endpoint,
  ]);
  useEffect(() => {
    let alive = true;
    api
      .mcpStatus()
      .then((status) => {
        if (!alive) return;
        setMcp(status);
        setMcpPort(String(status.port));
        setMcpReadonly(status.readonly);
      })
      .catch(() => {
        /* 浏览器预览或后端未就绪时静默，卡片仍可手动配置。 */
      });
    return () => {
      alive = false;
    };
  }, []);

  function pickEndpoint(next: Endpoint) {
    setEndpoint(next);
    const preset = ENDPOINTS.find((e) => e.value === next)!;
    setModels({ chat: [], vision: [] });
    if (next === "none") {
      setForm((f) => ({ ...f, provider: "", model: "", baseUrl: "" }));
    } else {
      setForm((f) => ({ ...f, provider: next, baseUrl: preset.base, model: preset.model }));
    }
  }

  /* 表单里尚未保存的配置；视觉模型留空时沿用主配置。 */
  function aiConfig(kind: "chat" | "vision") {
    const visionBase = form.visionBaseUrl.trim();
    const baseUrl = kind === "vision" ? visionBase || form.baseUrl.trim() : form.baseUrl.trim();
    const provider = kind === "vision" && visionBase ? endpointOf(visionBase) : form.provider;
    return {
      baseUrl,
      model: kind === "vision" ? form.visionModel.trim() || form.model.trim() : form.model.trim(),
      provider: provider === "none" ? "" : provider,
      apiKey: form.apiKey.trim() || undefined,
      thinking: kind === "vision" ? form.thinkingVision : form.thinkingExplain,
    };
  }

  async function fetchModels(kind: "chat" | "vision") {
    const cfg = aiConfig(kind);
    if (!cfg.baseUrl) {
      toast.error("先填写 API 地址。");
      return;
    }
    if (listing !== null) return;
    setListing(kind);
    try {
      const list = await api.aiModels(cfg, kind);
      setModels((m) => ({ ...m, [kind]: list }));
      if (list.length) {
        setModelMenu(kind);
        toast.success("找到 " + list.length + " 个模型");
      } else toast.error("服务没有返回模型列表，可以直接手填模型名。");
    } catch (e) {
      toast.error("获取模型失败：" + errText(e), { duration: 10000 });
    } finally {
      setListing(null);
    }
  }

  async function save() {
    setBusy(true);
    try {
      await api.saveSettings({
        apiKey: form.apiKey,
        clearKey: form.clearKey,
        model: form.model,
        base_url: form.baseUrl,
        provider: form.provider,
        vision_model: form.visionModel,
        vision_base_url: form.visionBaseUrl,
        thinking: form.thinkingExplain,
        thinking_organize: form.thinkingOrganize,
        thinking_vision: form.thinkingVision,
        thinking_explain: form.thinkingExplain,
        custom_prompt: form.prompt,
        timer_presets: form.presets,
        default_timer: form.defaultTimer,
        accent,
        theme,
      });
      const kept = form.clearKey ? false : form.hasKey || !!form.apiKey.trim();
      setForm((f) => ({ ...f, apiKey: "", clearKey: false, hasKey: kept }));
      toast.success("设置已保存");
    } catch (e) {
      toast.error(`保存失败：${e}`);
    } finally {
      setBusy(false);
    }
  }

  /* 用表单里尚未保存的配置直接测；空字段由后端回退到已保存设置，Key 只在这次请求里用。 */
  async function test(kind: "chat" | "vision") {
    const cfg = aiConfig(kind);
    const model = cfg.model;
    if (!cfg.baseUrl || !model) {
      toast.error(kind === "vision" ? "先填写视觉模型名（地址可留空，沿用主地址）。" : "先填写 API 地址和模型名。");
      return;
    }
    if (testing !== null) return;
    setTesting(kind);
    try {
      const r = await api.aiTest(cfg, kind);
      if (!r.ok) throw new Error(r.message || "连接测试没有通过。");
      const used = r.model || model;
      setTested((t) => (kind === "vision" ? { ...t, vision: used } : { ...t, chat: used }));
      const extra = r.message && !/^ok\b/i.test(r.message) ? r.message : undefined;
      toast.success(
        `${kind === "vision" ? "视觉模型" : "连接"}测试通过：${used} · ${r.elapsed_ms} ms`,
        extra ? { description: extra, duration: 6000 } : { duration: 6000 },
      );
    } catch (e) {
      toast.error(`连接失败：${errText(e)}`, { duration: 12000 });
    } finally {
      setTesting(null);
    }
  }

  function addPreset() {
    const n = Math.round(Number(presetInput));
    if (!Number.isFinite(n) || n <= 0 || n > 600) {
      toast.error("请输入 1~600 之间的分钟数。");
      return;
    }
    if (form.presets.includes(n)) {
      setPresetInput("");
      return;
    }
    if (form.presets.length >= 8) {
      toast.error("最多保留 8 个预设。");
      return;
    }
    setForm((f) => ({ ...f, presets: [...f.presets, n].sort((a, b) => a - b) }));
    setPresetInput("");
  }

  function removePreset(n: number) {
    setForm((f) => ({
      ...f,
      presets: f.presets.filter((x) => x !== n),
      defaultTimer: f.defaultTimer === n ? 0 : f.defaultTimer,
    }));
  }

  async function applyMcp(enabled: boolean, readonly = mcpReadonly) {
    const port = Math.round(Number(mcpPort));
    if (!Number.isFinite(port) || port < 1024 || port > 65535) {
      toast.error("MCP 端口需要是 1024~65535 之间的整数。");
      return;
    }
    setMcpBusy(true);
    try {
      const status = await api.mcpConfigure({ enabled, port, readonly });
      setMcp(status);
      setMcpPort(String(status.port));
      setMcpReadonly(status.readonly);
      if (status.lastError) throw new Error(status.lastError);
      toast.success(enabled ? "MCP 已启动：127.0.0.1:" + status.port : "MCP 已停止");
    } catch (e) {
      toast.error("MCP 操作失败：" + errText(e));
    } finally {
      setMcpBusy(false);
    }
  }

  async function regenerateMcp() {
    setMcpBusy(true);
    try {
      const status = await api.mcpRegenerateToken();
      setMcp(status);
      setMcpPort(String(status.port));
      setMcpReadonly(status.readonly);
      toast.success("Token 已重新生成；旧连接会立即失效。");
    } catch (e) {
      toast.error("重新生成失败：" + errText(e));
    } finally {
      setMcpBusy(false);
    }
  }

  function mcpConfigText() {
    if (!mcp) return "";
    return JSON.stringify(
      {
        mcpServers: {
          tokeru: {
            type: "http",
            url: mcp.url,
            headers: { Authorization: "Bearer " + mcp.token },
          },
        },
      },
      null,
      2,
    );
  }

  async function copyMcp(value: string, key: string) {
    try {
      await navigator.clipboard.writeText(value);
      setMcpCopied(key);
      window.setTimeout(() => setMcpCopied((cur) => (cur === key ? "" : cur)), 1600);
    } catch {
      toast.error("复制失败，请手动选中复制。");
    }
  }

  async function backup() {
    setBacking(true);
    try {
      const msg = await api.backupNow();
      toast.success(msg || "备份已保存");
    } catch (e) {
      toast.error(`备份失败：${e}`);
    } finally {
      setBacking(false);
    }
  }

  async function openRestore() {
    setRestoreOpen(true);
    setBackupsBusy(true);
    try {
      setBackups(await api.listBackups());
    } catch (e) {
      toast.error(`读取备份失败：${errText(e)}`);
    } finally {
      setBackupsBusy(false);
    }
  }

  async function restore(name: string) {
    setRestoring(name);
    try {
      await api.restoreBackup(name);
      setRestoreOpen(false);
      toast.success("已恢复备份");
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["sets"] }),
        qc.invalidateQueries({ queryKey: ["set"] }),
        qc.invalidateQueries({ queryKey: ["bank"] }),
        qc.invalidateQueries({ queryKey: ["tags"] }),
        qc.invalidateQueries({ queryKey: ["tagGroups"] }),
        qc.invalidateQueries({ queryKey: ["folders"] }),
        qc.invalidateQueries({ queryKey: ["records"] }),
        qc.invalidateQueries({ queryKey: ["attempt"] }),
        qc.invalidateQueries({ queryKey: ["mistakes"] }),
        qc.invalidateQueries({ queryKey: ["settings"] }),
      ]);
    } catch (e) {
      toast.error(`恢复失败：${errText(e)}`);
    } finally {
      setRestoring(null);
    }
  }

  const aiOff = endpoint === "none";
  const local = isLocalEndpoint(form.baseUrl);
  const keyReady = form.hasKey || !!form.apiKey.trim();
  const canTest = !aiOff && !!form.baseUrl.trim() && !!form.model.trim() && (keyReady || local);
  const visionBase = form.visionBaseUrl.trim() || form.baseUrl.trim();
  const canTestVision = !aiOff && !!form.visionModel.trim() && !!visionBase && (keyReady || isLocalEndpoint(visionBase));

  return (
    <main className="page page-narrow settings-page">
      <div className="page-head">
        <div>
          <h1>设置</h1>
          <div className="sub">AI 可选，计时与外观按你的习惯来。</div>
        </div>
        <div className="acts">
          <Button variant="primary" onClick={() => void save()} disabled={busy}>
            {busy ? <Loader2 size={15} className="spin" /> : <Save size={15} />} 保存设置
          </Button>
        </div>
      </div>

      <section className="panel panel-pad">
        <div className="panel-head">
          <div className="panel-title">AI（可选）</div>
          {tested.chat ? (
            <span title={`本次会话测试通过：${tested.chat}`}>
              <Chip tone="ok"><Check size={12} /> 已连接</Chip>
            </span>
          ) : form.hasKey ? (
            <Chip tone="ok"><Check size={12} /> 已保存 Key</Chip>
          ) : aiOff ? (
            <Chip>未启用</Chip>
          ) : (
            <Chip tone="warn">待填 Key</Chip>
          )}
        </div>
        <div className="panel-sub settings-lead">
          提问、判卷、整理与分图共用；Key 只存本机。
        </div>

        <div className="seg settings-seg" role="group" aria-label="AI 服务">
          {ENDPOINTS.map((e) => (
            <button key={e.value} type="button" data-on={endpoint === e.value} onClick={() => pickEndpoint(e.value)}>
              {e.label}
            </button>
          ))}
        </div>

        {aiOff ? (
          <div className="settings-off">
            默认不使用；需要时选一个服务并填 Key。
          </div>
        ) : (
          <>
            <div className="form-grid settings-grid">
              <Field
                label={local ? "API Key（本地可留空）" : "API Key"}
                hint={form.hasKey ? "已保存；留空保持不变。" : local ? "本地端点通常不校验 Key。" : "只保存在本机。"}
              >
                <input
                  className="input"
                  type="password"
                  placeholder={form.hasKey ? "已保存；留空保持不变" : local ? "可留空" : "sk-…"}
                  value={form.apiKey}
                  onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                  autoComplete="off"
                />
              </Field>
              <Field label="模型">
                <div className="model-field">
                  <div className="model-line">
                    <input
                      className="input"
                      value={form.model}
                      onChange={(e) => setForm({ ...form, model: e.target.value })}
                      onBlur={() => setTimeout(() => setModelMenu((m) => (m === "chat" ? null : m)), 120)}
                      spellCheck={false}
                    />
                    {models.chat.length ? (
                      <button type="button" className="model-toggle" onClick={() => setModelMenu((m) => (m === "chat" ? null : "chat"))} aria-label="选择模型">
                        <ChevronDown size={14} />
                      </button>
                    ) : null}
                  </div>
                  {modelMenu === "chat" && models.chat.length ? (
                    <div className="model-menu" onMouseDown={(e) => e.preventDefault()}>
                      {models.chat.map((m) => (
                        <button key={m} type="button" className="model-option" onClick={() => { setForm((f) => ({ ...f, model: m })); setModelMenu(null); }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="form-actions">
                  <Button size="sm" variant="ghost" onClick={() => void fetchModels("chat")} disabled={listing !== null}>
                    {listing === "chat" ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 获取模型
                  </Button>
                </div>
              </Field>
              <Field label="API 地址" hint="填到 /v1 为止，末尾不用写 /chat/completions。">
                <input
                  className="input"
                  value={form.baseUrl}
                  onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
              </Field>
              <Field label="多模态模型（自动分图）" hint="留空沿用上面的模型。">
                <div className="model-field">
                  <div className="model-line">
                    <input
                      className="input"
                      value={form.visionModel}
                      onChange={(e) => setForm({ ...form, visionModel: e.target.value })}
                      onBlur={() => setTimeout(() => setModelMenu((m) => (m === "vision" ? null : m)), 120)}
                      spellCheck={false}
                    />
                    {models.vision.length ? (
                      <button type="button" className="model-toggle" onClick={() => setModelMenu((m) => (m === "vision" ? null : "vision"))} aria-label="选择视觉模型">
                        <ChevronDown size={14} />
                      </button>
                    ) : null}
                  </div>
                  {modelMenu === "vision" && models.vision.length ? (
                    <div className="model-menu" onMouseDown={(e) => e.preventDefault()}>
                      {models.vision.map((m) => (
                        <button key={m} type="button" className="model-option" onClick={() => { setForm((f) => ({ ...f, visionModel: m })); setModelMenu(null); }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="form-actions">
                  <Button size="sm" variant="ghost" onClick={() => void fetchModels("vision")} disabled={listing !== null}>
                    {listing === "vision" ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />} 获取模型
                  </Button>
                </div>
              </Field>
              <Field label="视觉 API 地址（可选）" hint="留空沿用上面的 API 地址；也可以单独指向另一家兼容服务。">
                <input
                  className="input"
                  value={form.visionBaseUrl}
                  onChange={(e) => setForm({ ...form, visionBaseUrl: e.target.value })}
                  placeholder="https://api.openai.com/v1"
                  spellCheck={false}
                />
              </Field>
              <div className="field">
                <label>思考模式</label>
                <div className="settings-thinking">
                  <div className="settings-switch-row">
                    <Switch on={form.thinkingOrganize} onChange={(v) => setForm({ ...form, thinkingOrganize: v })} label="整理" />
                    <span>整理与判卷</span>
                  </div>
                  <div className="settings-switch-row">
                    <Switch on={form.thinkingVision} onChange={(v) => setForm({ ...form, thinkingVision: v })} label="视觉分图" />
                    <span>视觉分图</span>
                  </div>
                  <div className="settings-switch-row">
                    <Switch on={form.thinkingExplain} onChange={(v) => setForm({ ...form, thinkingExplain: v })} label="答案讲解" />
                    <span>答案讲解</span>
                  </div>
                </div>
              </div>
            </div>

            {form.hasKey || form.apiKey ? (
              <label className="check settings-check">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={form.clearKey}
                  onChange={(e) => setForm({ ...form, clearKey: e.target.checked })}
                />
                清除已保存的 Key
              </label>
            ) : null}

            <Field label="额外要求（可选）" hint="留空使用内置提示。">
              <textarea
                className="textarea settings-prompt"
                value={form.prompt}
                onChange={(e) => setForm({ ...form, prompt: e.target.value })}
                placeholder="例如：先点出错因，再给一句可复述的记忆点。"
              />
            </Field>

            <div className="form-actions">
              <Button onClick={() => void test("chat")} disabled={!canTest || testing !== null}>
                {testing === "chat" ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />} 测试连接
              </Button>
              {form.visionModel.trim() ? (
                <Button onClick={() => void test("vision")} disabled={!canTestVision || testing !== null}>
                  {testing === "vision" ? <Loader2 size={15} className="spin" /> : <Eye size={15} />} 测试视觉模型
                </Button>
              ) : null}
              {tested.vision ? (
                <span title={`视觉模型测试通过：${tested.vision}`}>
                  <Chip tone="ok"><Check size={12} /> 视觉可用</Chip>
                </span>
              ) : null}
              <span className="small muted"><KeyRound size={13} /> 用当前填写的配置直接测试，不必先保存。</span>
            </div>
          </>
        )}
      </section>

      <section className="panel panel-pad">
        <div className="panel-head">
          <div className="panel-title settings-title"><Plug size={17} /> MCP 连接</div>
          {mcp?.running ? (
            <Chip tone="ok"><Check size={12} /> 运行中</Chip>
          ) : mcp?.enabled ? (
            <Chip tone="warn">未启动</Chip>
          ) : (
            <Chip>已关闭</Chip>
          )}
        </div>
        <div className="panel-sub">
          让外部 Agent 读取题库、校验导入并写入试卷；默认只读，写操作需要显式关闭只读。
        </div>

        <div className="form-grid settings-grid">
          <Field label="启用本地服务" hint="只监听 127.0.0.1，不暴露到局域网。">
            <div className="settings-switch-row">
              <Switch on={!!mcp?.enabled} onChange={(v) => void applyMcp(v)} label="启用 MCP" />
              <span className="small muted">{mcp?.enabled ? "外部 Agent 现在可以连接。" : "关闭时端口不监听。"}</span>
            </div>
          </Field>
          <Field label="端口" hint="默认 17890；修改后需要重新应用。">
            <input
              className="input"
              inputMode="numeric"
              value={mcpPort}
              onChange={(e) => setMcpPort(e.target.value.replace(/[^0-9]/g, ""))}
              onBlur={() => {
                if (mcp?.enabled && Number(mcpPort) !== mcp.port) void applyMcp(true);
              }}
              aria-label="MCP 端口"
            />
          </Field>
          <Field label="只读模式" hint="开启后拒绝导入、改题、改名等写操作。">
            <div className="settings-switch-row">
              <Switch
                on={mcpReadonly}
                onChange={(v) => {
                  setMcpReadonly(v);
                  if (mcp?.enabled) void applyMcp(true, v);
                }}
                label="只读模式"
              />
            </div>
          </Field>
          <div className="field">
            <label>应用配置</label>
            <div className="form-actions">
              <Button size="sm" onClick={() => void applyMcp(!!mcp?.enabled)} disabled={mcpBusy}>
                {mcpBusy ? <Loader2 size={14} className="spin" /> : <Save size={14} />} 保存并应用
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void regenerateMcp()} disabled={mcpBusy}>
                <RefreshCw size={14} /> 重置 Token
              </Button>
            </div>
          </div>
        </div>

        {mcp ? (
          <div className="mcp-lines">
            <div className="mcp-line">
              <span className="mcp-label"><Globe size={13} /> 地址</span>
              <code>{mcp.url}</code>
              <Button size="sm" variant="ghost" onClick={() => void copyMcp(mcp.url, "url")} aria-label="复制 MCP 地址">
                <Copy size={13} /> {mcpCopied === "url" ? "已复制" : "复制"}
              </Button>
            </div>
            <div className="mcp-line">
              <span className="mcp-label"><KeyRound size={13} /> Token</span>
              <code className="mcp-token">{mcp.token}</code>
              <Button size="sm" variant="ghost" onClick={() => void copyMcp(mcp.token, "token")} aria-label="复制 MCP Token">
                <Copy size={13} /> {mcpCopied === "token" ? "已复制" : "复制"}
              </Button>
            </div>
            {mcp.lastError ? <div className="small mcp-error">{mcp.lastError}</div> : null}
            <div className="form-actions">
              <Button size="sm" variant="ghost" onClick={() => void copyMcp(mcpConfigText(), "config")}>
                <Copy size={13} /> {mcpCopied === "config" ? "已复制配置" : "复制配置"}
              </Button>
            </div>
            <details className="mcp-help">
              <summary>客户端配置示例</summary>
              <pre>{mcpConfigText()}</pre>
              <div className="small muted">不支持请求头的客户端可以用 <code>{mcp.url + "?token=" + mcp.token}</code>；这个链接含 Token，不要截图或转发。</div>
            </details>
          </div>
        ) : null}
      </section>

      <section className="panel panel-pad">
        <div className="panel-title settings-title"><Palette size={17} /> 外观</div>
        <div className="panel-sub">选中即生效，保存后下次打开仍沿用。</div>
        <div className="form-grid settings-grid">
          <Field label="主题色">
            <div className="seg settings-seg" role="group" aria-label="主题色">
              {ACCENTS.map((a) => (
                <button key={a.value} type="button" data-on={accent === a.value} onClick={() => setAccent(a.value)}>
                  {a.label}
                </button>
              ))}
            </div>
          </Field>
          <Field label="明暗">
            <div className="seg settings-seg" role="group" aria-label="明暗">
              {THEMES.map((t) => (
                <button key={t.value} type="button" data-on={theme === t.value} onClick={() => setTheme(t.value)}>
                  {t.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
      </section>

      <section className="panel panel-pad">
        <div className="panel-title settings-title"><Timer size={17} /> 默认计时</div>
        <div className="panel-sub">整卷页会直接列出这些分钟数，也可以临时改成自定义。</div>

        <div className="settings-presets">
          <div className="settings-chips">
            {form.presets.length ? (
              form.presets.map((m) => (
                <span className="settings-chip" key={m}>
                  {m} 分钟
                  <button type="button" onClick={() => removePreset(m)} aria-label={`删除 ${m} 分钟`}>
                    <X size={13} />
                  </button>
                </span>
              ))
            ) : (
              <span className="small muted">还没有预设，添加几个常用时长。</span>
            )}
          </div>
          <div className="settings-preset-add">
            <input
              className="input"
              inputMode="numeric"
              value={presetInput}
              onChange={(e) => setPresetInput(e.target.value.replace(/[^0-9]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPreset();
                }
              }}
              placeholder="分钟数"
              aria-label="新增预设分钟数"
            />
            <Button size="sm" onClick={addPreset} disabled={!presetInput}>
              <Plus size={15} /> 添加
            </Button>
          </div>
        </div>

        <Field label="默认值">
          <select
            className="select"
            value={form.defaultTimer}
            onChange={(e) => setForm({ ...form, defaultTimer: Number(e.target.value) })}
          >
            <option value={0}>不限时</option>
            {form.presets.map((m) => (
              <option key={m} value={m}>{m} 分钟</option>
            ))}
          </select>
        </Field>
      </section>

      <section className="panel panel-pad">
        <div className="panel-title settings-title"><Type size={17} /> 试卷排版</div>
        <div className="panel-sub">内置一套纸面默认方案；改动即时生效，考试页顶栏的「排版」也能随时调。</div>
        <PaperSettings
          style={paper}
          onChange={(next) => {
            setPaper(next);
            savePaperStyle(next);
          }}
        />
      </section>

      <section className="panel panel-pad">
        <div className="panel-title settings-title"><Database size={17} /> 数据与备份</div>
        <div className="panel-sub">所有题目、作答、错题都在本机。换电脑前先备份。</div>
        <div className="form-actions">
          <Button onClick={() => void backup()} disabled={backing}>
            {backing ? <Loader2 size={15} className="spin" /> : <Database size={15} />} 立即备份
          </Button>
          <Button variant="soft" onClick={() => void openRestore()} disabled={backing}>
            恢复备份
          </Button>
        </div>
      </section>

      <Modal open={restoreOpen} onClose={() => setRestoreOpen(false)} title="恢复备份" width={520}>
        <div className="panel-sub">恢复会覆盖当前题库、练习记录与错题；本机 AI Key 和 MCP Token 会保留。</div>
        {backupsBusy ? (
          <div className="small muted backup-empty"><Loader2 size={15} className="spin" /> 正在读取备份…</div>
        ) : backups.length === 0 ? (
          <div className="small muted backup-empty">还没有备份。</div>
        ) : (
          <div className="backup-list">
            {backups.map((name) => (
              <div className="backup-row" key={name}>
                <span>{name}</span>
                <Button size="sm" variant="soft" onClick={() => void restore(name)} disabled={!!restoring}>
                  {restoring === name ? <Loader2 size={14} className="spin" /> : null} 恢复
                </Button>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </main>
  );
}
