import http from "node:http";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve("tools/fixtures");
const PORT = Number(process.env.MOCK_VISION_PORT || 18080);

function send(res, status, body, type = "application/json") {
  res.writeHead(status, {
    "content-type": type,
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, "");
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/sample.png") {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "..", "e2e", "test-figure.png")), "image/png");
  }
  if (req.method === "GET" && url.pathname === "/sample.pdf") {
    return send(res, 200, fs.readFileSync(path.join(ROOT, "autofig-sample.pdf")), "application/pdf");
  }
  if (req.method === "GET" && url.pathname.endsWith("/api/tags")) {
    return send(res, 200, JSON.stringify({ models: [{ name: "mock-chat" }, { name: "mock-vision" }] }));
  }
  if (req.method === "GET" && url.pathname.endsWith("/models")) {
    return send(res, 200, JSON.stringify({ data: [{ id: "mock-chat" }, { id: "mock-vision" }] }));
  }
  if (req.method === "POST" && url.pathname.endsWith("/chat/completions")) {
    let raw = "";
    req.on("data", (c) => { raw += c; });
    req.on("end", () => {
      let parsed = null;
      try { parsed = JSON.parse(raw); } catch { /* ignore */ }
      const hasImages = JSON.stringify(parsed ?? {}).includes("data:image/");
      const content = JSON.stringify({
        figures: hasImages
          ? [
              { question: "1", page: 1, bbox: { x: 0.16, y: 0.3, w: 0.52, h: 0.22 }, caption: "对象框（模拟）" },
              { question: "1-2", page: 1, bbox: { x: 0.15, y: 0.62, w: 0.55, h: 0.2 }, caption: "多题共用图（模拟）" },
              { question: "2", page: 9, bbox: { x: 0.2, y: 0.2, w: 0.2, h: 0.2 }, caption: "页码越界，应丢弃" },
            ]
          : [],
      });
      send(res, 200, JSON.stringify({
        id: "mock",
        object: "chat.completion",
        model: "mock-vision",
        choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
      }));
    });
    return;
  }
  send(res, 404, JSON.stringify({ error: "not found" }));
});

server.listen(PORT, "127.0.0.1", () => console.log("[mock-vision] http://127.0.0.1:" + PORT));
