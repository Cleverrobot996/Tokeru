import fitz

doc = fitz.open(r"C:/Users/19646/Downloads/1717916773_9867.pdf")
parts = []
labels = ["一", "二", "三", "四", "五", "六"]
for i in range(6):
    page = doc[i]
    parts.append("===== PAGE " + str(i + 1) + " =====")
    parts.append(page.get_text("text", sort=True))
text = "\n".join(parts)
with open(r"tools/e2e/math-2024-questions.txt", "w", encoding="utf-8") as f:
    f.write(text)
print("chars", len(text))
