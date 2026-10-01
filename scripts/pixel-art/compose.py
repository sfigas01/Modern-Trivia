"""Composite the world layers the way pixel.css does, for a given viewport."""
import sys
from PIL import Image, ImageDraw

D = sys.argv[1]
VW, VH = int(sys.argv[2]), int(sys.argv[3])
out = sys.argv[4]
panel = len(sys.argv) > 5

SKY = [(0.0625, '#3d8bdc'), (0.125, '#438fdd'), (0.1875, '#4a94df'), (0.25, '#5199e1'), (0.3125, '#599ee3'), (0.375, '#62a4e4'), (0.4375, '#6aaae6'), (0.5, '#73b0e8'), (0.5625, '#7cb6eb'), (0.625, '#85bced'), (0.6875, '#8fc2ef'), (0.75, '#98c9f1'), (0.8125, '#a2cff3'), (0.875, '#abd6f5'), (0.9375, '#b5dcf8'), (1.01, '#bfe3fa')]

img = Image.new('RGBA', (VW, VH))
d = ImageDraw.Draw(img)
prev = 0
for stop, col in SKY:
    y = int(stop * VH)
    d.rectangle([0, prev, VW, y], fill=col)
    prev = y

vh = VH / 100
# back to front: (file, css w, css h, x percent, top y)
layers = [
    ('top', 1200, 260, 0.5, 0),
    ('mountains', 1280, 280, 0.5, 54 * vh - 280),
    ('mid', 1520, 180, 0.3, 30 * vh),
    ('islands', 1800, 640, 0.5, 46 * vh - 240),
    ('sea', 960, 300, 0.5, VH - 300),
]
for name, w, h, px, top in layers:
    tile = Image.open(f'{D}/{name}.png').convert('RGBA').resize((w, h), Image.NEAREST)
    x0 = (VW - w) * px
    x = x0 % w - w
    while x < VW:
        img.paste(tile, (int(x), int(top)), tile)
        x += w

if panel:
    cx = VW // 2
    pw = min(VW - 32, 448)
    d = ImageDraw.Draw(img)
    d.rectangle([cx - pw // 2, int(VH * 0.33), cx + pw // 2, int(VH * 0.72)], fill='#2b5ec0', outline='#0a0a0f', width=4)
img.convert('RGB').save(out)
