"""Super Questly app icon: a golden "?" block, drawn on a 16x16 pixel grid.

Writes favicon.svg (crisp at any size), favicon.png (32x32 fallback) and
apple-touch-icon.png (180x180, on sky blue) into the given folder.
"""
import sys

from PIL import Image

OUT = sys.argv[1]

INK = '#0a0a0f'
FACE = '#ffc92e'
LIGHT = '#ffe89c'
SHADE = '#e08a00'
DARK = '#6b3a00'
MARK = '#fff7d6'

QUESTION = [
    '.####.',
    '##..##',
    '....##',
    '...##.',
    '..##..',
    '..##..',
    '......',
    '..##..',
    '..##..',
]


def grid():
    g = [[None] * 16 for _ in range(16)]
    for y in range(16):
        for x in range(16):
            corner = (x in (0, 15)) and (y in (0, 15))
            if corner:
                continue
            if x in (0, 15) or y in (0, 15):
                g[y][x] = INK
            elif x == 1 or y == 1:
                g[y][x] = LIGHT
            elif x == 14 or y == 14:
                g[y][x] = SHADE
            else:
                g[y][x] = FACE
    for rx, ry in ((2, 2), (13, 2), (2, 13), (13, 13)):  # rivets
        g[ry][rx] = DARK
    ox, oy = 5, 3
    for layer, (dx, dy), col in ((0, (1, 1), DARK), (1, (0, 0), MARK)):
        for y, row in enumerate(QUESTION):
            for x, ch in enumerate(row):
                if ch == '#':
                    g[oy + y + dy][ox + x + dx] = col
    return g


def svg(g):
    rects = []
    for y, row in enumerate(g):
        x = 0
        while x < 16:
            c = row[x]
            if c is None:
                x += 1
                continue
            x1 = x
            while x1 < 16 and row[x1] == c:
                x1 += 1
            rects.append(f'<rect x="{x}" y="{y}" width="{x1 - x}" height="1" fill="{c}"/>')
            x = x1
    return ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" '
            'shape-rendering="crispEdges">' + ''.join(rects) + '</svg>\n')


def png(g, scale, size=None, bg=None):
    art = Image.new('RGBA', (16, 16), (0, 0, 0, 0))
    for y, row in enumerate(g):
        for x, c in enumerate(row):
            if c:
                art.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    art = art.resize((16 * scale, 16 * scale), Image.NEAREST)
    if size is None:
        return art
    canvas = Image.new('RGBA', (size, size), bg or (0, 0, 0, 0))
    off = (size - art.width) // 2
    canvas.alpha_composite(art, (off, off))
    return canvas


if __name__ == '__main__':
    g = grid()
    open(f'{OUT}/favicon.svg', 'w').write(svg(g))
    png(g, 2).save(f'{OUT}/favicon.png', optimize=True)
    png(g, 10, 180, (74, 163, 247, 255)).convert('RGB').save(f'{OUT}/apple-touch-icon.png', optimize=True)
    print('icons written to', OUT)
