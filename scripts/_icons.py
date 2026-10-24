from PIL import Image, ImageDraw, ImageFont
import os
base = r"src-tauri/icons"
os.makedirs(base, exist_ok=True)
size = 1024
img = Image.new("RGBA", (size, size), (0,0,0,0))
d = ImageDraw.Draw(img)
# rounded square
d.rounded_rectangle([40,40,984,984], radius=220, fill=(106,90,205,255))
# T
try:
    font = ImageFont.truetype("C:/Windows/Fonts/georgiab.ttf", 600)
except Exception:
    font = ImageFont.load_default()
text = "T"
bbox = d.textbbox((0,0), text, font=font)
w = bbox[2]-bbox[0]; h = bbox[3]-bbox[1]
d.text(((size-w)/2-bbox[0], (size-h)/2-bbox[1]-20), text, font=font, fill=(255,251,245,255))
# small accent dot
d.ellipse([760,760,860,860], fill=(245,190,80,255))
img.save(os.path.join(base,"icon.png"))
for s in (32,128,256,512):
    img.resize((s,s), Image.LANCZOS).save(os.path.join(base, f"{s}x{s}.png"))
img.resize((256,256), Image.LANCZOS).save(os.path.join(base,"128x128@2x.png"))
img.resize((256,256), Image.LANCZOS).save(os.path.join(base,"icon.ico"), sizes=[(16,16),(32,32),(48,48),(64,64),(128,128),(256,256)])
# icns placeholder not needed for Windows build; copy png
img.resize((512,512), Image.LANCZOS).save(os.path.join(base,"icon.icns"))
print("icons done")
