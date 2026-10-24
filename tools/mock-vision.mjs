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
              { question: "1", page: 1, bbox: [0.16, 0.3, 0.52, 0.22], caption: "矩形与对角线（模拟）" },
              { question: "2", page: 1, bbox: [0.9, 0.9, 0.05, 0.05], caption: "太小，应被裁切跳过" },
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
