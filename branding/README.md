# Tokeru 标志

## 图形

一个三叶结，结心收着一枚琥珀色对勾。

- 结：三处上下穿插，代表「材料 → 题目」被组织成可练习的结构。
- 勾：结心的一笔，代表解出与掌握。
- 不依赖字母 T，缩小到 16px 仍保留结的轮廓。

## 资产

| 文件 | 用途 |
| --- | --- |
| `icon-d1-dark.svg` | 主图标：深色圆角底 + 米白结 + 琥珀勾 |
| `icon-d1-dark-small.svg` | ≤32px 简版：去掉交叉缺口、加粗勾 |
| `icon-d1-light.svg` | 浅色侧栏 38px 透明底版：深紫结 + 琥珀勾 |
| `icon-d1-construction.svg` | 结构线稿：标出三处交叉点 |
| `icon-d1-review.html` / `.png` | 设计稿与尺寸阶梯 |

应用图标、安装器图标与各平台图标由 `pnpm tauri icon` 生成到 `src-tauri/icons`。应用内组件是 `src/components/Logo.tsx` 的 `TokeroMark`。

## 使用

- 侧栏浅色背景用 `icon-d1-light.svg` 的线条版；深色启动图/商店图标用 `icon-d1-dark.svg`。
- 16–32px 用简版，不要直接缩放主图标。
- 不改变结的交叉关系；去掉缺口会退化成三个环。

## 修改约定

- 几何同时存在于 SVG 与 `Logo.tsx`，改动需同步。
- 颜色用 `#1E1930`（深底）、`#F3E7D3`（米白结）、`#DFA53C`（琥珀勾）；浅色版用 `#3B2B6B` + `#C98B21`。
