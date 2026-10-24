import "./../styles/tags.css";
import clsx from "clsx";
import { X } from "lucide-react";
import type { KeyboardEvent, MouseEvent } from "react";
import type { TagInfo } from "../lib/types";

/**
 * 标签展示。
 * - grouped：按标签栏显示「学科：数学」，标签栏颜色来自 group_color；
 * - plain：只显示标签名，标签之间并列，适合题干、卡片等紧凑位置。
 * TagBoard 的拖拽标签也复用同一套 .tag-chip 外观。
 */
export type TagChipsProps = {
  tags: string[];
  tagMap?: Map<string, TagInfo>;
  mode: "grouped" | "plain";
  colors?: boolean;
  max?: number;
  onRemove?: (tag: string) => void;
  /** 标签本身可点击时传入（例如当作筛选条件）。 */
  onClick?: (tag: string) => void;
  className?: string;
};

export function TagChips({
  tags,
  tagMap,
  mode,
  colors = true,
  max,
  onRemove,
  onClick,
  className,
}: TagChipsProps) {
  if (tags.length === 0) return null;

  const limit = typeof max === "number" && max >= 0 ? Math.min(max, tags.length) : tags.length;
  const shown = tags.slice(0, limit);
  const rest = tags.length - shown.length;

  return (
    <span className={clsx("tag-chips", mode === "plain" && "is-plain", className)}>
      {shown.map((tag) => {
        const info = tagMap?.get(tag);
        const groupName = mode === "grouped" ? (info?.group_name ?? "").trim() : "";
        const color = colors ? (info?.group_color ?? "").trim() : "";
        const onActivate = onClick ? () => onClick(tag) : undefined;
        return (
          <span
            key={tag}
            className="tag-chip"
            data-color={color || undefined}
            role={onActivate ? "button" : undefined}
            tabIndex={onActivate ? 0 : undefined}
            onClick={
              onActivate
                ? (event: MouseEvent<HTMLSpanElement>) => {
                    event.stopPropagation();
                    onActivate();
                  }
                : undefined
            }
            onKeyDown={
              onActivate
                ? (event: KeyboardEvent<HTMLSpanElement>) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onActivate();
                    }
                  }
                : undefined
            }
            title={onActivate ? `筛选「${tag}」` : tag}
          >
            {groupName ? <span className="tag-chip-group">{groupName}：</span> : null}
            <span className="tag-chip-name">{tag}</span>
            {onRemove ? (
              <button
                type="button"
                className="tag-chip-x"
                aria-label={`移除标签 ${tag}`}
                title={`移除标签 ${tag}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(tag);
                }}
              >
                <X size={11} strokeWidth={2.5} />
              </button>
            ) : null}
          </span>
        );
      })}
      {rest > 0 ? (
        <span className="tag-chip is-more" title={tags.slice(limit).join("、")}>
          +{rest}
        </span>
      ) : null}
    </span>
  );
}
