import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Check, Moon, Palette, Sun } from "lucide-react";
import { useTheme, type Accent, type ThemeMode } from "../lib/theme";
import { Button } from "./ui";

const ACCENTS: { value: Accent; label: string; color: string }[] = [
  { value: "violet", label: "鸢尾", color: "#6a5acd" },
  { value: "teal", label: "青瓷", color: "#0f766e" },
  { value: "amber", label: "琥珀", color: "#a4600b" },
  { value: "rose", label: "胭脂", color: "#a13a5c" },
  { value: "slate", label: "青灰", color: "#475569" },
];

const MODES: { value: ThemeMode; label: string }[] = [
  { value: "light", label: "浅色" },
  { value: "dark", label: "深色" },
  { value: "system", label: "跟随系统" },
];

/*
 * 外观与主题菜单：顶栏与考试工作台共用。
 * compact 用于考试页工具栏，按钮缩到 30px，其余交互一致。
 */
export function ThemeMenu({ compact = false, className }: { compact?: boolean; className?: string }) {
  const { theme, accent, setTheme, setAccent } = useTheme();
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();

  /* 换页就收起，避免菜单悬在下一个页面。 */
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const iconSize = compact ? 16 : 18;
  const themeIcon =
    theme === "dark" ? <Moon size={iconSize} /> : theme === "light" ? <Sun size={iconSize} /> : <Palette size={iconSize} />;

  return (
    <div ref={anchorRef} className={className ? "top-anchor " + className : "top-anchor"}>
      <Button
        variant="ghost"
        className="icon-btn"
        style={compact ? { width: 30, height: 30, borderRadius: 9 } : undefined}
        onClick={() => setOpen((v) => !v)}
        aria-label="外观与主题"
        title="外观与主题"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {themeIcon}
      </Button>
      {open ? (
        <div className="popover top-pop" role="menu" aria-label="外观与主题">
          <div className="pop-label">外观</div>
          {MODES.map((m) => (
            <button
              key={m.value}
              className="popover-item"
              role="menuitemradio"
              aria-checked={theme === m.value}
              onClick={() => setTheme(m.value)}
            >
              {m.value === "light" ? (
                <Sun size={15} />
              ) : m.value === "dark" ? (
                <Moon size={15} />
              ) : (
                <Palette size={15} />
              )}
              {m.label}
              {theme === m.value ? <Check size={14} className="pop-check" /> : null}
            </button>
          ))}
          <div className="hr top-pop-hr" />
          <div className="pop-label">主题色</div>
          <div className="swatches">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                className={"swatch" + (accent === a.value ? " active" : "")}
                style={{ background: a.color }}
                title={a.label}
                aria-label={a.label}
                aria-pressed={accent === a.value}
                onClick={() => setAccent(a.value)}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ThemeMenu;
