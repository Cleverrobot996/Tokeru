import { useEffect } from "react";
import clsx from "clsx";
import { ArrowLeft, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "default",
  size,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "primary" | "soft" | "ghost" | "danger";
  size?: "sm";
}) {
  return (
    <button
      className={clsx("btn", variant !== "default" && `btn-${variant}`, size === "sm" && "btn-sm", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Chip({ tone = "default", children }: { tone?: "default" | "accent" | "ok" | "warn" | "bad"; children: ReactNode }) {
  return <span className={clsx("chip", tone !== "default" && `chip-${tone}`)}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint ? <div className="small muted">{hint}</div> : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  width,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal" style={{ width: width ? `min(92vw, ${width}px)` : undefined }} role="dialog" aria-modal="true">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
          <h3 style={{ margin: 0 }}>{title}</h3>
          <Button variant="ghost" className="icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </Button>
        </div>
        {children}
      </div>
    </>
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      className="switch"
      data-on={on ? "true" : "false"}
      aria-label={label}
      aria-pressed={on}
      onClick={() => onChange(!on)}
    />
  );
}

export function Markdown({ children }: { children: string }) {
  return (
    <div className="ai-output">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeSanitize]}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

export function Back({ to = "/" }: { to?: string }) {
  return (
    <a href={to} className="btn btn-ghost btn-sm" style={{ marginBottom: 10, paddingLeft: 0 }}>
      <ArrowLeft size={15} /> 返回
    </a>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
