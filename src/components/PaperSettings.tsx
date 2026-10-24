import { useRef, useState } from "react";
import { Check, RefreshCw, RotateCcw, Search, Type, Upload, X } from "lucide-react";
import {
  CUSTOM_FONT_FAMILY,
  PAPER_DEFAULT,
  PAPER_PRESETS,
  clearCustomFont,
  importCustomFont,
  normalizePaperStyle,
  paperCssVars,
  samePaperStyle,
  type PaperFont,
  type PaperStyle,
} from "../lib/paper";
import { api } from "../lib/api";
import { Button, Modal } from "./ui";

const FONT_OPTIONS: { id: PaperFont; label: string }[] = [
  { id: "serif", label: "衬线" },
  { id: "sans", label: "无衬线" },
];

function Slider({
  label,
  value,
  min,
  max,
  step,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix: string;
  onChange: (value: number) => void;
}) {
  const text = step < 1 ? value.toFixed(2).replace(/0$/, "") : String(value);
  return (
    <label className="paper-row">
      <span className="paper-row-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        aria-label={label}
      />
      <output>
        {text}
        {suffix}
      </output>
    </label>
  );
}

/** 试卷排版的实时预览：中性示例，只用于检查字号、行距、对比度与答案层级。 */
export function PaperPreview({ style }: { style: PaperStyle }) {
  return (
    <div
      className="paper-preview"
      style={paperCssVars(style)}
      data-contrast={style.contrast}
      data-paper-preview
      aria-label="试卷排版预览"
    >
      <div className="paper-sheet paper-preview-sheet">
        <header className="paper-mast">
          <div className="paper-mast-eyebrow">PREVIEW · 排版示例</div>
          <h2>示例试卷 · 阅读与填空</h2>
          <div className="paper-mast-meta">
            <span>3 题</span>
            <span>满分 30</span>
            <span>建议 20 分钟</span>
          </div>
        </header>

        <section className="paper-sec">
          <div className="paper-sec-head">
            <h2>PART I READING</h2>
            <span className="paper-sec-meta">3 题 · 30 分</span>
          </div>
          <div className="paper-instr">阅读下面的材料，完成题目。预览会随上方字号、行距与对比度设置实时变化。</div>
          <div className="paper-material">
            <div className="paper-material-title">PASSAGE</div>
            <div className="paper-material-body">
              阅读不是把文字从头到尾看一遍，而是在有限的时间里找到作者真正想说明的东西。先看题干，再回到原文定位，往往比逐字通读更有效。
            </div>
          </div>
          <div className="paper-bank">
            <div className="paper-bank-title">词库</div>
            <div className="paper-bank-grid">
              <span><b>A</b> 定位</span>
              <span><b>B</b> 概括</span>
              <span><b>C</b> 推断</span>
              <span><b>D</b> 复述</span>
            </div>
          </div>

          <article className="paper-q">
            <div className="paper-q-head">
              <span className="paper-q-no">1</span>
              <span className="paper-q-points">10 分</span>
            </div>
            <div className="paper-q-stem">作者认为阅读时更有效的做法是？</div>
            <div className="paper-opts">
              <div className="paper-opt"><b>A</b><span>逐字通读全文</span></div>
              <div className="paper-opt"><b>B</b><span>先看题干再定位</span></div>
              <div className="paper-opt"><b>C</b><span>只记生词</span></div>
              <div className="paper-opt"><b>D</b><span>跳过材料</span></div>
            </div>
            <div className="paper-answer">正确答案：B　解析：先看题干，再回到原文定位，可以减少无关信息的干扰。</div>
          </article>

          <article className="paper-q">
            <div className="paper-q-head">
              <span className="paper-q-no">2</span>
              <span className="paper-q-points">10 分</span>
            </div>
            <div className="paper-q-stem">
              文中把阅读比作在有限时间里寻找（<span className="blank"></span>）。
            </div>
          </article>

          <article className="paper-q">
            <div className="paper-q-head">
              <span className="paper-q-no">3</span>
              <span className="paper-q-points">10 分</span>
            </div>
            <div className="paper-q-stem">用一句话概括作者的主要观点。</div>
            <div className="paper-answer">参考文本：阅读应先明确问题，再有选择地回到原文寻找依据。</div>
          </article>
        </section>
      </div>
    </div>
  );
}

export function PaperSettings({
  style,
  onChange,
  compact = false,
  preview = true,
}: {
  style: PaperStyle;
  onChange: (style: PaperStyle) => void;
  compact?: boolean;
  preview?: boolean;
}) {
  const activePreset = PAPER_PRESETS.find((preset) =>
    samePaperStyle(
      { ...preset.style, contrast: style.contrast, family: style.family, familyLabel: style.familyLabel },
      style,
    ),
  )?.id;
  const patch = (next: Partial<PaperStyle>) => onChange(normalizePaperStyle({ ...style, ...next }));

  const [fontOpen, setFontOpen] = useState(false);
  const [fonts, setFonts] = useState<string[]>([]);
  const [fontQuery, setFontQuery] = useState("");
  const [fontBusy, setFontBusy] = useState(false);
  const [fontNote, setFontNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const filteredFonts = fonts.filter((name) => name.toLowerCase().includes(fontQuery.trim().toLowerCase()));

  async function loadSystemFonts() {
    setFontBusy(true);
    setFontNote("");
    try {
      let names = await api.listSystemFonts();
      if (!names.length) {
        const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> }).queryLocalFonts;
        if (query) {
          try {
            const local = await query();
            names = Array.from(new Set(local.map((font) => font.family)));
          } catch {
            names = [];
          }
        }
      }
      names = names.sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
      if (names.length) {
        setFonts(names);
        setFontNote(`已读取 ${names.length} 个字体。`);
      } else {
        setFontNote("这个环境读不到系统字体，可以直接选择字体文件；桌面版会读取 Windows 已安装字体。");
      }
    } catch {
      setFontNote("读取系统字体失败，可以直接选择字体文件。");
    } finally {
      setFontBusy(false);
    }
  }

  function openFontPicker() {
    setFontOpen(true);
    setFontNote("");
    if (!fonts.length && !fontBusy) void loadSystemFonts();
  }

  function applyFamily(family: string, label?: string) {
    patch({ family, familyLabel: label ?? family });
    setFontOpen(false);
  }

  function clearFamily() {
    clearCustomFont();
    patch({ family: "", familyLabel: "" });
  }

  async function onFontFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 24 * 1024 * 1024) {
      setFontNote("字体文件超过 24 MB，换一个小一点的。");
      return;
    }
    setFontBusy(true);
    setFontNote("");
    try {
      const result = await importCustomFont(file);
      patch({ family: result.family, familyLabel: result.label });
      setFontNote(result.persisted ? "字体已保存，下次打开仍然生效。" : "字体文件较大，只在本会话生效。");
      setFontOpen(false);
    } catch {
      setFontNote("这个字体文件无法加载，换一个 .ttf / .otf / .woff2 试试。");
    } finally {
      setFontBusy(false);
    }
  }

  const fontValue = style.family ? style.familyLabel || style.family : style.font === "serif" ? "阅读体" : "界面体";

  return (
    <div className={"paper-settings" + (compact ? " is-compact" : "")}>
      <div className="seg paper-presets" role="group" aria-label="排版预设">
        {PAPER_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            data-on={activePreset === preset.id}
            onClick={() =>
              onChange(
                normalizePaperStyle({
                  ...preset.style,
                  contrast: style.contrast,
                  family: style.family,
                  familyLabel: style.familyLabel,
                }),
              )
            }
            title={preset.hint}
          >
            {preset.label}
          </button>
        ))}
        <span className="paper-preset-hint">
          {activePreset ? PAPER_PRESETS.find((p) => p.id === activePreset)?.hint : "自定义"}
        </span>
      </div>

      <div className="paper-controls">
        <div className="paper-row">
          <span className="paper-row-label">字体</span>
          <div className="seg paper-font-seg" role="group" aria-label="试题字体">
            {FONT_OPTIONS.map((font) => (
              <button key={font.id} type="button" data-on={style.font === font.id} onClick={() => patch({ font: font.id })}>
                {font.label}
              </button>
            ))}
          </div>
          <span className="paper-row-value" title={fontValue}>{fontValue}</span>
        </div>

        <div className="paper-row">
          <span className="paper-row-label">对比度</span>
          <div className="seg paper-contrast-seg" role="group" aria-label="试卷对比度">
            <button type="button" data-on={style.contrast !== "high"} onClick={() => patch({ contrast: "normal" })}>
              标准
            </button>
            <button
              type="button"
              data-on={style.contrast === "high"}
              onClick={() => patch({ contrast: "high" })}
              title="去掉材料与说明的浅色底，加强文字和分隔线"
            >
              高对比
            </button>
          </div>
          <span className="paper-row-value">{style.contrast === "high" ? "高对比" : "标准"}</span>
        </div>

        <div className="paper-font-pick">
          <span className="paper-font-current">
            {style.family ? (
              <>
                <Type size={13} />
                <span className="paper-font-chip" title={style.familyLabel || style.family}>
                  <span className="paper-font-chip-text">{style.familyLabel || style.family}</span>
                  <button type="button" aria-label="清除自定义字体" onClick={clearFamily} title="改回内置字体">
                    <X size={12} />
                  </button>
                </span>
              </>
            ) : (
              <span className="small muted">当前使用内置字体</span>
            )}
          </span>
          <Button size="sm" variant="ghost" onClick={openFontPicker}>
            <Type size={14} /> 选择字体
          </Button>
        </div>

        {fontNote ? <div className="paper-font-status small muted">{fontNote}</div> : null}

        <Slider label="字号" value={style.size} min={14} max={22} step={1} suffix=" px" onChange={(size) => patch({ size })} />
        <Slider label="行高" value={style.leading} min={1.4} max={2.2} step={0.05} suffix="" onChange={(leading) => patch({ leading })} />
        <Slider label="段距" value={style.gap} min={4} max={28} step={2} suffix=" px" onChange={(gap) => patch({ gap })} />
        <Slider label="纸宽" value={style.width} min={720} max={1040} step={20} suffix=" px" onChange={(width) => patch({ width })} />
      </div>

      {preview ? <PaperPreview style={style} /> : null}

      <div className="paper-reset-row">
        <Button size="sm" onClick={() => onChange(PAPER_DEFAULT)}>
          <RotateCcw size={14} /> 恢复默认
        </Button>
      </div>

      <Modal open={fontOpen} onClose={() => setFontOpen(false)} title="选择字体" width={540}>
        <div className="paper-font-modal">
          <div className="paper-font-actions">
            <Button size="sm" variant="primary" onClick={() => fileRef.current?.click()} disabled={fontBusy}>
              <Upload size={14} /> 选择字体文件
            </Button>
            <Button size="sm" variant="ghost" onClick={loadSystemFonts} disabled={fontBusy}>
              <RefreshCw size={14} /> 读取系统字体
            </Button>
            <span className="small muted">支持 .ttf / .otf / .woff / .woff2</span>
          </div>
          <input ref={fileRef} type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" className="paper-font-file" onChange={onFontFile} />
          {fonts.length ? (
            <label className="paper-font-search">
              <Search size={14} />
              <input
                value={fontQuery}
                onChange={(event) => setFontQuery(event.target.value)}
                placeholder={`搜索 ${fonts.length} 个字体`}
                aria-label="搜索字体"
              />
            </label>
          ) : null}
          {fontBusy ? <div className="paper-font-note">正在读取字体…</div> : null}
          {fontNote ? <div className="paper-font-note">{fontNote}</div> : null}
          {fonts.length ? (
            <div className="paper-font-list">
              {filteredFonts.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="paper-font-item"
                  data-on={style.family === name}
                  onClick={() => applyFamily(name)}
                >
                  <span className="paper-font-item-name">{name}</span>
                  <span className="paper-font-item-sample" style={{ fontFamily: `"${name}", var(--font-ui)` }}>
                    Aa 试卷 Paper 123
                  </span>
                  {style.family === name ? <Check size={14} /> : null}
                </button>
              ))}
              {!filteredFonts.length ? <div className="paper-font-note">没有匹配的字体。</div> : null}
            </div>
          ) : null}
          {!fonts.length && !fontBusy ? (
            <div className="paper-font-note">
              也可以直接选择本机字体文件。桌面版会读取 Windows 已安装字体；选中的字体会用于试卷正文与预览。
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
