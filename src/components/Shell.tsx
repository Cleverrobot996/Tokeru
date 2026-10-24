import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { Clock3, Home, Library, NotebookPen, Settings2, Upload } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Toaster } from "sonner";
import { TokeroMark } from "./Logo";
import { ThemeMenu } from "./ThemeMenu";

/* 侧栏：默认 108px（图标在上、文字在下）；点开关完全收起（0px），内容铺满窗口。状态写进 localStorage。 */
const RAIL_KEY = "tokero:rail-collapsed";

/* 侧栏开关图标：面板轮廓 + 左侧分栏线。 */
function PanelGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width={19}
      height={19}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3.4" y="4.4" width="17.2" height="15.2" rx="3.2" />
      <path d="M9.2 4.7v14.6" />
    </svg>
  );
}

type NavItem = { to: string; label: string; icon: LucideIcon; end?: boolean };

const groups: { label: string; items: NavItem[] }[] = [
  {
    label: "学习",
    items: [
      { to: "/", label: "首页", icon: Home, end: true },
      { to: "/bank", label: "题库", icon: Library },
      { to: "/records", label: "练习记录", icon: Clock3 },
      { to: "/mistakes", label: "错题本", icon: NotebookPen },
    ],
  },
  {
    label: "管理",
    items: [
      { to: "/import", label: "导入", icon: Upload },
      { to: "/settings", label: "设置", icon: Settings2 },
    ],
  },
];

function readRailOpen() {
  try {
    return localStorage.getItem(RAIL_KEY) !== "1";
  } catch {
    return true;
  }
}

/* 考试工作台是专注界面：整条顶栏都不渲染，答题区拿到完整高度。 */
function isExamRoute(pathname: string) {
  return pathname === "/exam" || pathname.startsWith("/exam/");
}

export default function Shell() {
  const [railOpen, setRailOpen] = useState(readRailOpen);
  const railToggleRef = useRef<HTMLButtonElement | null>(null);
  const railOpenBtnRef = useRef<HTMLButtonElement | null>(null);
  const prevRailOpen = useRef(railOpen);
  const location = useLocation();
  const [scrolled, setScrolled] = useState(false);
  const examMode = isExamRoute(location.pathname);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_KEY, railOpen ? "0" : "1");
    } catch {
      /* 隐私模式写不进去就只在本次会话生效 */
    }
  }, [railOpen]);

  /* 收起/展开后把焦点交给另一个开关，避免焦点停在已隐藏的按钮上。 */
  useEffect(() => {
    if (prevRailOpen.current === railOpen) return;
    prevRailOpen.current = railOpen;
    if (railOpen) railToggleRef.current?.focus();
    else railOpenBtnRef.current?.focus();
  }, [railOpen]);

  useEffect(() => {
    if (examMode) return;
    const onScroll = () => setScrolled(window.scrollY > 2);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [examMode]);

  return (
    <div className="shell" data-rail={railOpen ? "open" : "closed"}>
      <aside className="rail" id="rail" aria-label="主导航" aria-hidden={!railOpen}>
        <div className="rail-head">
          <button
            type="button"
            ref={railToggleRef}
            className="rail-toggle"
            onClick={() => setRailOpen(false)}
            aria-controls="rail"
            aria-expanded={railOpen}
            title="收起侧栏"
            aria-label="收起侧栏"
          >
            <PanelGlyph />
          </button>
          <NavLink to="/" className="rail-brand" title="Tokeru 首页" aria-label="Tokeru 首页">
            <span className="rail-mark" aria-hidden="true"><TokeroMark size={26} /></span>
            <span className="rail-brand-text">
              <span className="rail-name">Tokeru</span>
            </span>
          </NavLink>
        </div>

        <nav className="rail-nav">
          {groups.map((group) => (
            <div className="rail-group" key={group.label}>
              <div className="rail-group-label">{group.label}</div>
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    title={item.label}
                    aria-label={item.label}
                    className={({ isActive }) => "rail-link" + (isActive ? " active" : "")}
                  >
                    <Icon aria-hidden="true" />
                    <span className="rail-label">{item.label}</span>
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>

      <div className="main">
        {!examMode && (
          <header className={["topbar", scrolled ? "scrolled" : ""].filter(Boolean).join(" ")}>
            <div className="crumbs">
              {!railOpen && (
                <button
                  type="button"
                  ref={railOpenBtnRef}
                  className="rail-open-btn"
                  onClick={() => setRailOpen(true)}
                  aria-controls="rail"
                  aria-expanded={railOpen}
                  title="展开侧栏"
                  aria-label="展开侧栏"
                >
                  <PanelGlyph />
                </button>
              )}
            </div>
            <div className="top-actions">
              <ThemeMenu />
            </div>
          </header>
        )}
        <Outlet />
      </div>
      <Toaster position="bottom-right" richColors closeButton />
    </div>
  );
}
