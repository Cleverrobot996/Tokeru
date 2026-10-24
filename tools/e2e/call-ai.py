# 调用 DeepSeek 把试卷提示词转成 Tokeru JSON。Key 从环境变量 DEEPSEEK_KEY 读取，不落盘。
import argparse, json, os, re, sys, urllib.request, urllib.error

p = argparse.ArgumentParser()
p.add_argument("--prompt", required=True)
p.add_argument("--out", required=True)
p.add_argument("--model", default="deepseek-chat")
p.add_argument("--max-tokens", type=int, default=8000)
a = p.parse_args()

key = os.environ.get("DEEPSEEK_KEY")
if not key:
    sys.exit("缺少环境变量 DEEPSEEK_KEY")

prompt = open(a.prompt, encoding="utf-8").read()
body = json.dumps({
    "model": a.model,
    "messages": [
        {"role": "system", "content": "你是把试卷材料整理成 Tokeru 导入 JSON 的助手。严格按用户给出的规范输出，只输出一个 JSON 对象，不要解释、不要 Markdown 代码围栏。"},
        {"role": "user", "content": prompt},
    ],
    "temperature": 0,
    "max_tokens": a.max_tokens,
    "response_format": {"type": "json_object"},
    "stream": False,
}).encode("utf-8")

req = urllib.request.Request("https://api.deepseek.com/chat/completions", data=body,
                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + key})
try:
    with urllib.request.urlopen(req, timeout=600) as resp:
        data = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    sys.exit("HTTP " + str(e.code) + ": " + e.read().decode("utf-8", "replace")[:1000])

content = data["choices"][0]["message"]["content"] or ""
usage = data.get("usage", {})
content = re.sub(r"^\s*```(?:json)?\s*", "", content.strip())
content = re.sub(r"\s*```\s*$", "", content)
try:
    obj = json.loads(content)
except Exception as e:
    open(a.out + ".raw.txt", "w", encoding="utf-8").write(content)
    sys.exit("AI 返回不是合法 JSON: " + str(e) + "（原文已存 " + a.out + ".raw.txt）")
open(a.out, "w", encoding="utf-8").write(json.dumps(obj, ensure_ascii=False, indent=2))
q = obj.get("questions", [])
print("saved", a.out, "questions", len(q), "sections", len(obj.get("sections", [])),
      "materials", len(obj.get("materials", [])), "tokens", usage)
