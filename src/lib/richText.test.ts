// @vitest-environment node
import { describe, expect, it } from "vitest";
import { hasTable, richTextHtml, richInlineHtml } from "./richText";

describe("richText 公式与表格", () => {
  it("行内公式交给 KaTeX，原始 TeX 不丢", () => {
    const html = richInlineHtml("已知 $x^2+1$ 的值");
    expect(html).toContain("katex");
    expect(html).not.toContain("$x^2+1$");
  });

  it("纯数字公式也按数学渲染，不当作货币", () => {
    const html = richInlineHtml("$0$ 和 $2$");
    expect(html).toContain("katex");
    expect(html).not.toContain("$0$");
  });

  it("块级公式使用 display 模式", () => {
    const html = richTextHtml("$$\frac{1}{2}$$");
    expect(html).toContain("math-display");
    expect(html).toContain("katex-display");
  });

  it("GFM 管道表格渲染成 table-wrap", () => {
    const source = "| 组 | 温度 |\n| --- | --- |\n| A | 25 |\n| B | 40 |";
    expect(hasTable(source)).toBe(true);
    const html = richTextHtml(source);
    expect(html).toContain('class="table-wrap"');
    expect(html).toContain("<th>组</th>");
    expect(html).toContain("<td>A</td>");
  });

  it("表格单元格内的公式也会渲染", () => {
    const html = richTextHtml("| 函数 | 值 |\n| --- | --- |\n| $f(1)$ | $2$ |");
    expect(html).toContain("katex");
    expect(html).toContain("<td>");
  });

  it("普通文本不会被误判成表格", () => {
    expect(hasTable("a | b 只是普通文本")).toBe(false);
  });
});
