from PIL import Image, ImageDraw, ImageFont
import os

OUT = os.path.join(os.path.dirname(__file__), 'public', 'icons')
os.makedirs(OUT, exist_ok=True)

CANDIDATES = [
    r'C:\Windows\Fonts\msyh.ttc',
    r'C:\Windows\Fonts\msyhbd.ttc',
    r'C:\Windows\Fonts\simhei.ttf',
]

def load_font(size):
    for p in CANDIDATES:
        if os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()

def make(size, path, dark_bg=True):
    bg = (15, 23, 42) if dark_bg else (248, 250, 252)
    card = (248, 250, 252) if dark_bg else (15, 23, 42)
    txt = (15, 23, 42) if dark_bg else (248, 250, 252)
    img = Image.new('RGB', (size, size), bg)
    d = ImageDraw.Draw(img)
    m = size // 8
    d.rounded_rectangle([m, m, size - m, size - m], radius=size // 10, fill=card)
    font = load_font(int(size * 0.52))
    text = '词'
    bbox = d.textbbox((0, 0), text, font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - tw) / 2 - bbox[0], (size - th) / 2 - bbox[1]), text, font=font, fill=txt)
    img.save(path)
    print('wrote', path, size)

make(512, os.path.join(OUT, 'icon-512.png'))
make(192, os.path.join(OUT, 'icon-192.png'))
make(180, os.path.join(OUT, 'apple-touch-icon.png'))

# 小 favicon 用 SVG（text 元素）
svg = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#0f172a"/>
  <rect x="8" y="8" width="48" height="48" rx="10" fill="#f8fafc"/>
  <text x="32" y="43" font-family="Microsoft YaHei, sans-serif" font-size="30" font-weight="bold" text-anchor="middle" fill="#0f172a">词</text>
</svg>
'''
with open(os.path.join(OUT, 'favicon.svg'), 'w', encoding='utf-8') as f:
    f.write(svg)
print('wrote favicon.svg')
