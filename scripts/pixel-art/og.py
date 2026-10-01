"""Social share image (1280x720): the sky world, wordmark and tagline."""
import os
import subprocess
import tempfile
import sys
import re

from PIL import Image, ImageDraw

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import clashblock as cb  # noqa: E402

WORLD, OUT = sys.argv[1], sys.argv[2]
W, H = 1280, 720

tmp = os.path.join(tempfile.mkdtemp(), 'world.png')
subprocess.run([sys.executable, os.path.join(HERE, 'compose.py'), WORLD, str(W), str(H), tmp], check=True)
img = Image.open(tmp).convert('RGBA')


def wordmark_png(lines, scale):
    """Rasterise the wordmark from its pixel grid at an integer scale."""
    svg, (vw, vh) = cb.wordmark_svg(lines, scale=1)
    im = Image.new('RGBA', (vw * scale, vh * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for x, y, w, h, fill in re.findall(r'<rect x="(-?\d+)" y="(-?\d+)" width="(\d+)" height="(\d+)" fill="(#\w+)"/>', svg):
        x, y, w, h = int(x) + 1, int(y) + 1, int(w), int(h)
        d.rectangle([x * scale, y * scale, (x + w) * scale - 1, (y + h) * scale - 1], fill=fill)
    return im


def pixel_text(text, px, fill='#ffffff', shadow='#0a0a0f'):
    """Text in the Clash Block glyphs: white with a hard 1px drop shadow."""
    cols = cb.word_cols(text)
    w, h = len(cols) + 1, 10
    im = Image.new('RGBA', (w * px, h * px), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for layer, off, col in ((0, 1, shadow), (1, 0, fill)):
        for x, c in enumerate(cols):
            if c is None:
                continue
            for y, v in enumerate(c):
                if v == '#':
                    d.rectangle([(x + off) * px, (y + off) * px, (x + off + 1) * px - 1, (y + off + 1) * px - 1],
                                fill=col)
    return im


mark = wordmark_png(['SUPER', 'QUESTLY'], 5)
img.alpha_composite(mark, ((W - mark.width) // 2, 70))

tag = pixel_text('TRIVIA THAT EVERYONE CAN PLAY', 3)
pad = 18
chip = Image.new('RGBA', (tag.width + pad * 2, tag.height + pad * 2 - 6), '#1d4499')
d = ImageDraw.Draw(chip)
d.rectangle([0, 0, chip.width - 1, chip.height - 1], outline='#0a0a0f', width=5)
cx, cy = (W - chip.width) // 2, 70 + mark.height + 26
shadow = Image.new('RGBA', chip.size, '#0a0a0f')
img.alpha_composite(shadow, (cx + 6, cy + 6))
img.alpha_composite(chip, (cx, cy))
img.alpha_composite(tag, (cx + pad, cy + pad - 3))

img.convert('RGB').save(OUT, quality=88, optimize=True)
print('saved', OUT)
