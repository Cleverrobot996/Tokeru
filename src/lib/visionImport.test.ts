import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PageImage } from "./pdf";

const pdfMocks = vi.hoisted(() => ({
  cropPage: vi.fn(),
}));

vi.mock("./pdf", () => ({
  cropPage: pdfMocks.cropPage,
  loadImage: vi.fn(),
}));

vi.mock("./api", () => ({ api: {} }));
vi.mock("./importPrompt", () => ({ buildPrompt: vi.fn() }));

import { buildFigureMap, parseVisionOcr, resolveFigureTokens } from "./visionImport";

function page(number: number): PageImage {
  return {
    page: number,
    dataUrl: "data:image/jpeg;base64,AAAA" + number,
    width: 800,
    height: 1000,
  };
}

function bboxOf(content: string, pageNumber = 1): [number, number, number, number] | undefined {
  const parsed = parseVisionOcr(content, pageNumber);
  return parsed.figures[0]?.bbox;
}

describe("visionImport bbox", () => {
  beforeEach(() => {
    pdfMocks.cropPage.mockReset();
    pdfMocks.cropPage.mockResolvedValue("data:image/jpeg;base64,CROP");
  });

  it("解析数组 bbox 并 clamp 到页面内", () => {
    const parsed = parseVisionOcr(
      JSON.stringify({
        markdown: "如图 {{fig:f1}}",
        figures: [{ id: "f1", bbox: [-0.1, 0.1, 0.5, 0.6] }],
      }),
      1,
    );
    expect(parsed.figures[0].bbox).toEqual([0, 0.1, 0.5, 0.6]);
  });

  it("解析 {x1,y1,x2,y2} 对象 bbox", () => {
    expect(
      bboxOf(
        JSON.stringify({
          markdown: "如图 {{fig:f1}}",
          figures: [{ id: "f1", bbox: { x1: 10, y1: 20, x2: 40, y2: 45 } }],
        }),
      ),
    ).toEqual([0.1, 0.2, 0.3, 0.25]);
  });

  it("解析 {x,y,w,h} 对象 bbox", () => {
    expect(
      bboxOf(
        JSON.stringify({
          markdown: "如图 {{fig:f1}}",
          figures: [{ id: "f1", bbox: { x: 0.1, y: 0.2, w: 0.3, h: 0.25 } }],
        }),
      ),
    ).toEqual([0.1, 0.2, 0.3, 0.25]);
  });

  it("解析百分数 bbox", () => {
    expect(
      bboxOf(
        JSON.stringify({
          markdown: "如图 {{fig:f1}}",
          figures: [{ id: "f1", bbox: ["10%", "20%", "30%", "25%"] }],
        }),
      ),
    ).toEqual([0.1, 0.2, 0.3, 0.25]);
  });

  it("过滤过小的 bbox", () => {
    expect(
      bboxOf(
        JSON.stringify({
          markdown: "如图 {{fig:f1}}",
          figures: [{ id: "f1", bbox: [0, 0, 0.001, 0.5] }],
        }),
      ),
    ).toBeUndefined();
  });

  it("没有 bbox 时不使用整页图", async () => {
    const pages = [page(1)];
    const map = await buildFigureMap([{ id: "f1", dataUrl: "", page: 1 }], pages);
    expect(map.size).toBe(0);
    expect(pdfMocks.cropPage).not.toHaveBeenCalled();
    const resolution = await resolveFigureTokens("如图 {{fig:f1}}", map);
    expect(resolution.text).toContain("（原题有图，见原卷）");
    expect(resolution.skipped).toBe(1);
  });

  it("有 bbox 时按页裁图并写入映射", async () => {
    const pages = [page(1), page(2)];
    const bbox: [number, number, number, number] = [0.1, 0.2, 0.3, 0.4];
    const map = await buildFigureMap([{ id: "f1", dataUrl: "", page: 2, bbox }], pages);
    expect(pdfMocks.cropPage).toHaveBeenCalledTimes(1);
    expect(pdfMocks.cropPage).toHaveBeenCalledWith(pages[1], bbox);
    expect(map.get("f1")).toBe("data:image/jpeg;base64,CROP");
  });

  it("兼容 [[FIG:id]] 并按批次起始页换算页码", () => {
    const parsed = parseVisionOcr(
      JSON.stringify({
        pages: [
          {
            page: 1,
            markdown: "第一页 [[FIG:x]]",
            figures: [{ id: "x", bbox: [0.1, 0.1, 0.2, 0.2] }],
          },
          {
            page: 2,
            markdown: "第二页 {{fig:y}}",
            figures: [{ id: "y", bbox: [0.2, 0.2, 0.2, 0.2] }],
          },
        ],
      }),
      5,
    );
    expect(parsed.markdown).toContain("{{fig:fig1}}");
    expect(parsed.markdown).not.toContain("[[FIG:");
    expect(parsed.figures.map((figure) => figure.id)).toEqual(["fig1", "fig2"]);
    expect(parsed.figures.map((figure) => figure.page)).toEqual([5, 6]);
    expect(parsed.figures.map((figure) => figure.bbox)).toEqual([
      [0.1, 0.1, 0.2, 0.2],
      [0.2, 0.2, 0.2, 0.2],
    ]);
  });
});
