"""Trivia Clash sky world: SNES-style pixel-art background layers.

Each layer is a horizontally tiling PNG at native art resolution (1 art px is
shown as 2 CSS px). Wider screens reveal more of the tile / more repeats, so
nothing ever stretches.
"""
import math
import random
import sys
from PIL import Image

OUT = sys.argv[1] if len(sys.argv) > 1 else '.'

BAYER = [[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]]


def hexc(h):
    h = h.lstrip('#')
    return (int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16), 255)


def pal(*hs):
    return [hexc(h) for h in hs]


def clamp(v, a=0.0, b=1.0):
    return a if v < a else b if v > b else v


def dq(v, palette, x, y):
    """Dithered quantize of v in [0,1] onto a dark->light palette."""
    n = len(palette) - 1
    f = clamp(v) * n
    i = int(f)
    if i >= n:
        return palette[n]
    t = (BAYER[y & 3][x & 3] + 0.5) / 16
    return palette[i + 1] if (f - i) > t else palette[i]


class Canvas:
    def __init__(self, w, h, wrap=False):
        self.w, self.h, self.wrap = w, h, wrap
        self.px = [[None] * w for _ in range(h)]
        self.tag = [[0] * w for _ in range(h)]

    def put(self, x, y, c, tag=0):
        if self.wrap:
            x %= self.w
        if 0 <= x < self.w and 0 <= y < self.h:
            self.px[y][x] = c
            self.tag[y][x] = tag

    def get(self, x, y):
        if self.wrap:
            x %= self.w
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.px[y][x]
        return None

    def gettag(self, x, y):
        if self.wrap:
            x %= self.w
        if 0 <= x < self.w and 0 <= y < self.h:
            return self.tag[y][x]
        return 0

    def save(self, path):
        img = Image.new('RGBA', (self.w, self.h), (0, 0, 0, 0))
        data = []
        for row in self.px:
            for c in row:
                data.append(c if c else (0, 0, 0, 0))
        img.putdata(data)
        img = img.quantize(colors=255, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
        img.save(path, optimize=True)


# ---------------------------------------------------------------- clouds
CLOUD = pal('#8fb8e2', '#acd0f0', '#cbe3f7', '#e6f2fc', '#ffffff')
CLOUD_FAR = pal('#8db6e0', '#a3c7ec', '#bad7f3', '#d2e6f8', '#e8f3fc')


def cloud(c, puffs, palette=CLOUD, base=None, warm=0.0, lobed=False):
    """Cumulus: puffs drawn top to bottom so lower puffs overlap upper ones.
    Each puff is lit from the upper left; `base` flattens the underside."""
    # lobed: base filler (4th field) first, then biggest to smallest lobes
    order = (lambda p: (len(p) == 3, -p[2])) if lobed else (lambda p: (p[1], p[0]))
    for (cx, cy, r, *_) in sorted(puffs, key=order):
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            if base is not None and y > base:
                continue
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                d2 = dx * dx + dy * dy
                if d2 > r * r:
                    continue
                nx, ny = dx / r, dy / r
                nz = math.sqrt(max(0.0, 1 - nx * nx - ny * ny))
                light = -0.35 * nx - 0.8 * ny + 0.45 * nz
                v = 0.52 + 0.62 * light
                if base is not None:
                    v -= 0.35 * clamp(1 - (base - y) / 10)
                c.put(x, y, dq(v + warm, palette, x, y), 1)


def puff_row(rng, x0, x1, ybase, rmin, rmax, jitter=6):
    puffs = []
    x = x0
    while x < x1:
        r = rng.uniform(rmin, rmax)
        puffs.append((x, ybase - r * rng.uniform(0.35, 0.8) + rng.uniform(-jitter, jitter) * 0.3, r))
        x += r * rng.uniform(0.9, 1.3)
    return puffs


def cumulus(rng, cx, base, width, height):
    """Heaped cumulus: a crown of lobes stepping down to each side, each with
    smaller cauliflower lobes drawn over it, on a flat base (pass the same
    `base` and lobed=True to cloud())."""
    big = []
    r0 = height * 0.46
    big.append((cx, base - height + r0, r0))
    for side in (-1, 1):
        x, r, top = cx, r0, height
        while True:
            r *= rng.uniform(0.72, 0.86)
            x += side * r * rng.uniform(0.85, 1.1)
            if abs(x - cx) + r > width / 2 or r < 5:
                break
            top *= rng.uniform(0.68, 0.82)
            big.append((x, base - top + r, r))
    puffs = list(big)
    for (bx, by, br) in big:
        if br < 9:
            continue
        for k in range(rng.randint(2, 4)):
            ang = math.pi * (1.15 + 0.7 * (k + rng.uniform(0.1, 0.9)) / 4)
            puffs.append((bx + math.cos(ang) * br * 0.6, by + math.sin(ang) * br * 0.5,
                          br * rng.uniform(0.38, 0.52)))
    xs = [p[0] - p[2] * 0.6 for p in big] + [p[0] + p[2] * 0.6 for p in big]
    lo, hi = min(xs), max(xs)
    k = max(2, int((hi - lo) / 12))
    for i in range(k + 1):
        puffs.append((lo + (hi - lo) * i / k, base - 4, 9, 'base'))
    return puffs


# ---------------------------------------------------------------- islands
GRASS = pal('#1f5f2a', '#2f8a34', '#46a83c', '#69c449', '#9ee06a')
DIRT = pal('#3e2312', '#5e3519', '#7f4b22', '#a0652f', '#c08249', '#d79c62')
ROCK = pal('#4b4640', '#6b655d', '#8c857b', '#aaa398', '#c9c2b6')
LEAF = pal('#17431d', '#22612a', '#2f8034', '#47a03f', '#6cc04f', '#97da69')
STONE = pal('#46433f', '#615d57', '#7f7a73', '#9d988f', '#bdb8ae')
OUT_DIRT = hexc('#26160b')
OUT_GRASS = hexc('#163f1c')
OUT_LEAF = hexc('#10301a')
OUT_STONE = hexc('#2b2926')
TRUNK = pal('#3a2414', '#5c3a1e', '#7a5029')

T_GRASS, T_DIRT, T_LEAF, T_STONE, T_TRUNK = 2, 3, 4, 5, 6


def noise1(rng, n, smooth=4, amp=1.0):
    vals = [rng.uniform(-1, 1) for _ in range(n // smooth + 3)]
    out = []
    for i in range(n):
        k = i / smooth
        a = int(k)
        t = k - a
        t = t * t * (3 - 2 * t)
        out.append((vals[a] * (1 - t) + vals[a + 1] * t) * amp)
    return out


SKY_HAZE = (150, 200, 240, 255)


def haze(c, x0, y0, x1, y1, amt, before):
    """Blend pixels drawn since `before` (a snapshot) toward the sky colour."""
    for y in range(max(0, y0), min(c.h, y1)):
        for x in range(x0, x1):
            p = c.get(x, y)
            if p is not None and before.get((x % c.w if c.wrap else x, y)) != p:
                q = tuple(round(p[k] * (1 - amt) + SKY_HAZE[k] * amt) for k in range(3)) + (255,)
                c.put(x, y, q, c.gettag(x, y))


def snapshot(c, x0, y0, x1, y1):
    return {(x, y): c.get(x, y) for y in range(max(0, y0), min(c.h, y1)) for x in range(x0, x1)}


def island(c, rng, x0, y0, w, depth, trees=(), ruin=None, bushes=0, rocks=None, far=0.0):
    gh = 7 if w > 60 else 5
    snap = snapshot(c, x0 - 40, y0 - 90, x0 + w + 40, y0 + depth + 40) if far else None
    top_n = noise1(rng, w, 8, 1.3)
    bot_n = noise1(rng, w, 3, 4.0)
    spikes = [0] * w
    for _ in range(max(2, w // 14)):
        sx = rng.randint(int(w * 0.12), int(w * 0.88))
        sl = rng.randint(5, 16)
        for k in range(-3, 4):
            if 0 <= sx + k < w:
                spikes[sx + k] = max(spikes[sx + k], sl * (1 - abs(k) / 4))
    ys = []
    for i in range(w):
        x = x0 + i
        u = 2 * (i + 0.5) / w - 1
        end = clamp((1 - abs(u)) * w / 12)
        ytop = y0 + round(top_n[i]) + round((1 - math.sqrt(clamp(end))) * 5)
        prof = (1 - abs(u) ** 1.4) ** 0.85
        yb = ytop + gh + round(depth * prof + bot_n[i] * prof + spikes[i] * prof)
        ys.append(ytop)
        lip = gh + (rng.choice([0, 0, 1, 2, 2, 3, 4]) if abs(u) < 0.96 else 0)
        for y in range(ytop, yb + 1):
            k = y - ytop
            if k < lip:
                if k == 0:
                    col = GRASS[4] if (x * 7 + y) % 6 else GRASS[3]
                elif k < gh - 2:
                    col = dq(0.82 - k * 0.09 - u * 0.12, GRASS, x, y)
                else:
                    col = GRASS[1] if k < gh else GRASS[0]
                c.put(x, y, col, T_GRASS)
            else:
                f = (k - gh) / max(1, yb - ytop - gh)
                band = ((k + int(top_n[i] * 3) + (i // 9) % 2) // 6) % 2
                v = 0.8 - 0.7 * f - 0.22 * u + (0.07 if band else -0.05)
                c.put(x, y, dq(v, DIRT, x, y), T_DIRT)
    # embedded boulders, outlined so they read as stones
    for _ in range(rocks if rocks is not None else max(2, w // 12)):
        i = rng.randint(4, w - 5)
        rr = rng.randint(2, 5 if w > 60 else 3)
        rx = x0 + i
        ry = ys[i] + gh + rng.randint(2, max(3, int(depth * 0.5)))
        pts = []
        for y in range(-rr, rr + 1):
            for x in range(-rr - 2, rr + 3):
                if (x / (rr + 1.5)) ** 2 + (y / rr) ** 2 <= 1 and c.gettag(rx + x, ry + y) == T_DIRT:
                    pts.append((x, y))
        for x, y in pts:
            edge = any((x + a, y + b) not in pts for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1)))
            if edge and y >= 0:
                c.put(rx + x, ry + y, ROCK[0], T_DIRT)
            else:
                v = 0.6 - 0.3 * (x / (rr + 1.5)) - 0.4 * (y / rr)
                c.put(rx + x, ry + y, dq(v, ROCK, rx + x, ry + y), T_DIRT)
    # dangling roots under the grass lip
    for _ in range(w // 10):
        i = rng.randint(3, w - 4)
        x = x0 + i
        y = ys[i] + gh
        for k in range(rng.randint(3, 8)):
            if c.gettag(x, y + k) != T_DIRT:
                break
            c.put(x, y + k, DIRT[0], T_DIRT)
            if rng.random() < 0.3:
                x += rng.choice([-1, 1])
    for _ in range(bushes):
        i = rng.randint(6, w - 7)
        bx = x0 + i
        canopy(c, [(bx, ys[i] - 1, rng.randint(3, 5)), (bx + 4, ys[i], 3.5), (bx - 4, ys[i], 3)])
    if ruin:
        ru, rw, rh = ruin
        i = int(ru * (w - 1))
        ruins(c, rng, x0 + i, ys[i] + 2, rw, rh)
    for (tu, size) in sorted(trees, key=lambda t: t[1]):
        i = int(clamp(tu) * (w - 1))
        tree(c, rng, x0 + i, ys[i] + 1, size)
    outline(c, x0 - 30, y0 - 80, x0 + w + 30, y0 + depth + 40)
    if far:
        haze(c, x0 - 30, y0 - 80, x0 + w + 30, y0 + depth + 40, far, snap)


def canopy(c, blobs):
    for (cx, cy, r) in blobs:
        for y in range(int(cy - r) - 1, int(cy + r) + 2):
            for x in range(int(cx - r) - 1, int(cx + r) + 2):
                dx, dy = x + 0.5 - cx, y + 0.5 - cy
                if dx * dx + dy * dy <= r * r:
                    nx, ny = dx / r, dy / r
                    nz = math.sqrt(max(0, 1 - nx * nx - ny * ny))
                    v = 0.48 + 0.6 * (-0.45 * nx - 0.72 * ny + 0.5 * nz)
                    c.put(x, y, dq(v, LEAF, x, y), T_LEAF)


def tree(c, rng, x, ground, size):
    th = max(3, size // 2 + 2)
    for y in range(ground - th - size // 2, ground + 1):
        for k in (-1, 0, 1):
            c.put(x + k, y, TRUNK[0] if k == 1 else TRUNK[2] if k == -1 else TRUNK[1], T_TRUNK)
    cy = ground - th - size * 0.85
    blobs = [(x, cy, size)]
    for a in (0.85, 1.2, 1.55, 1.9, 2.25):
        ang = math.pi * a + rng.uniform(-0.15, 0.15)
        blobs.append((x + math.cos(ang) * size * 0.75, cy - math.sin(ang) * size * 0.45 + size * 0.25,
                      size * rng.uniform(0.6, 0.78)))
    blobs.append((x - size * 0.25, cy - size * 0.45, size * 0.6))
    canopy(c, sorted(blobs, key=lambda b: b[1]))


def stone_block(c, x0, y0, bw, bh, light):
    for y in range(bh):
        for x in range(bw):
            if (x in (0, bw - 1) and y in (0, bh - 1)):
                continue
            edge = x == 0 or y == 0 or x == bw - 1 or y == bh - 1
            if edge:
                col = OUT_STONE
            else:
                v = light + 0.25 * (1 - x / bw) + 0.2 * (1 - y / bh) - 0.15
                if y == 1 or x == 1:
                    v += 0.15
                col = dq(v, STONE, x0 + x, y0 + y)
            c.put(x0 + x, y0 + y, col, T_STONE)


def ruins(c, rng, x, ground, w, h):
    """An intact stone castle tower: coursed brick, a corbelled parapet with
    even merlons, an arched window and doorway, and a short crenellated wall."""
    MORTAR = STONE[0]
    DARK = OUT_STONE

    def masonry(x0, x1, y0, y1, light=0.0):
        for y in range(y0, y1):
            course = (y1 - 1 - y) // 4
            for xx in range(x0, x1):
                off = 4 if course % 2 else 0
                if (y1 - 1 - y) % 4 == 3 or (xx - x0 + off) % 8 == 7:
                    col = MORTAR
                else:
                    side = (xx - x0) / max(1, x1 - x0 - 1)
                    top_of_brick = (y1 - 1 - y) % 4 == 2
                    v = 0.78 - 0.5 * side + light + (0.12 if top_of_brick else 0)
                    col = dq(v, STONE, xx, y)
                c.put(xx, y, col, T_STONE)

    def merlons(x0, x1, ytop, mh=4, mw=4, gap=3):
        xx = x0
        while xx + mw <= x1:
            masonry(xx, xx + mw, ytop - mh, ytop, 0.05)
            xx += mw + gap
        if xx < x1:
            masonry(x1 - mw, x1, ytop - mh, ytop, 0.05)

    top = ground - h
    # short curtain wall to the left
    ww, wh = 14, h // 2
    masonry(x - ww, x, ground - wh, ground + 1, -0.05)
    merlons(x - ww, x, ground - wh, mh=3, mw=3, gap=3)
    # tower body
    masonry(x, x + w, top, ground + 1)
    # parapet: one course wider than the body, then merlons
    masonry(x - 1, x + w + 1, top - 4, top, 0.04)
    for xx in range(x - 1, x + w + 1):
        c.put(xx, top, MORTAR, T_STONE)
    merlons(x - 1, x + w + 1, top - 4)
    # arched window
    wx = x + w // 2 - 2
    wy = top + 6
    for y in range(wy, wy + 8):
        for k in range(4):
            if y == wy and k in (0, 3):
                continue
            c.put(wx + k, y, DARK, T_STONE)
    for k in range(-1, 5):
        c.put(wx + k, wy + 8, STONE[4], T_STONE)
    # arched doorway with a wooden door
    dx = x + w // 2 - 3
    dh = min(10, h // 3)
    for y in range(ground - dh, ground + 1):
        for k in range(6):
            if y == ground - dh and k in (0, 5):
                continue
            edge = k in (0, 5) or y == ground - dh or (y == ground - dh + 1 and k in (1, 4))
            c.put(dx + k, y, DARK if edge else (TRUNK[1] if k % 2 else TRUNK[2]), T_STONE)
    # a little moss at the foot
    for xx in range(x - ww, x + w):
        if rng.random() < 0.35 and c.gettag(xx, ground) == T_STONE:
            c.put(xx, ground, GRASS[2], T_STONE)
            if rng.random() < 0.4:
                c.put(xx, ground - 1, GRASS[1], T_STONE)


def outline(c, x0, y0, x1, y1):
    marks = []
    for y in range(y0, y1):
        for x in range(x0, x1):
            if c.get(x, y) is not None:
                continue
            for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                t = c.gettag(x + dx, y + dy)
                if t in (T_GRASS, T_DIRT, T_LEAF, T_STONE, T_TRUNK):
                    col = {T_GRASS: OUT_GRASS, T_DIRT: OUT_DIRT, T_LEAF: OUT_LEAF,
                           T_STONE: OUT_STONE, T_TRUNK: OUT_DIRT}[t]
                    marks.append((x, y, col))
                    break
    for x, y, col in marks:
        c.put(x, y, col, 9)


# ---------------------------------------------------------------- layers
def layer_sea():
    W, H = 480, 150
    c = Canvas(W, H, wrap=True)
    rng = random.Random(7)
    cloud(c, puff_row(rng, 0, W, 72, 16, 28), CLOUD_FAR)
    cloud(c, puff_row(rng, 10, W + 10, 98, 18, 30), CLOUD, warm=-0.04)
    cloud(c, puff_row(rng, 25, W + 25, 128, 20, 34), CLOUD, warm=0.06)
    for y in range(118, H):
        for x in range(W):
            if c.get(x, y) is None:
                c.put(x, y, CLOUD[4] if y > 132 else CLOUD[3], 1)
    c.save(f'{OUT}/sea.png')


def layer_top():
    W, H = 600, 130
    c = Canvas(W, H, wrap=True)
    rng = random.Random(11)
    # cloud ceiling hanging into view along parts of the top edge
    cloud(c, puff_row(rng, -40, 120, 6, 18, 30), CLOUD)
    cloud(c, puff_row(rng, 400, 560, 2, 16, 28), CLOUD)
    for (cx, base, w, h) in [(80, 100, 130, 82), (320, 68, 100, 54), (500, 120, 170, 98), (215, 126, 64, 28)]:
        cloud(c, cumulus(rng, cx, base, w, h), CLOUD if h > 30 else CLOUD_FAR, base=base, lobed=True)
    c.save(f'{OUT}/top.png')


def layer_mid():
    W, H = 760, 90
    c = Canvas(W, H, wrap=True)
    rng = random.Random(23)
    for (cx, base, w, h) in [(60, 74, 76, 40), (250, 52, 50, 26), (420, 84, 96, 46), (640, 62, 60, 30)]:
        cloud(c, cumulus(rng, cx, base, w, h), CLOUD, base=base, lobed=True)
    c.save(f'{OUT}/mid.png')


ROCK_LIT = pal('#7d97bf', '#8fa9cc', '#a3bbd8', '#b9cde3')
ROCK_SHADE = pal('#4a6290', '#57709d', '#657fab', '#768fb8')
SNOW_LIT = pal('#d9e7f6', '#eef5fd', '#ffffff')
SNOW_SHADE = pal('#a9c0de', '#bccfe7', '#cddcee')


def layer_mountains():
    W, H = 640, 140
    c = Canvas(W, H, wrap=True)
    rng = random.Random(5)

    def draw_range(peaks, fade):
        snap = snapshot(c, 0, 0, W, H)
        # tallest first so nearer, shorter peaks overlap them
        for (px, ph, hl, hr) in sorted(peaks, key=lambda p: -p[1]):
            jag_l = noise1(rng, hl + 2, 3, 2.0)
            jag_r = noise1(rng, hr + 2, 3, 2.0)
            ridge = noise1(rng, ph + 2, 4, 2.2)
            snow = noise1(rng, hl + hr + 2, 2, 0.06)
            top_y = H - ph
            for dx in range(-hl, hr):
                x = px + dx
                if dx < 0:
                    yt = top_y + ph * (-dx / hl) ** 1.1 + jag_l[-dx] * (-dx / hl)
                else:
                    yt = top_y + ph * (dx / hr) ** 0.95 + jag_r[dx] * (dx / hr)
                for y in range(max(0, int(yt)), H):
                    e = (y - top_y) / ph
                    split = px + ridge[min(ph, max(0, y - top_y))] * e * 3 + e * 4
                    lit = x < split
                    crevice = ((x - px) * (1 if lit else -1) + y * 0.7 + jag_l[abs(dx) % hl] * 2) % 11 < 1.2 \
                        and e > 0.25 and rng.random() < 0.8
                    if e < 0.3 + snow[dx + hl]:
                        pal_ = SNOW_LIT if lit else SNOW_SHADE
                        v = 0.7 - e
                    else:
                        pal_ = ROCK_LIT if lit else ROCK_SHADE
                        v = 0.65 - 0.25 * e - (0.35 if crevice else 0) + 0.5 * max(0, e - 0.7)
                    c.put(x, y, dq(v, pal_, x, y), 1)
        if fade:
            haze(c, 0, 0, W, H, fade, snap)

    draw_range([(40, 110, 70, 60), (170, 96, 60, 70), (290, 120, 80, 64), (430, 104, 66, 72), (560, 116, 74, 70)],
               0.35)
    draw_range([(100, 78, 50, 56), (230, 70, 46, 50), (360, 84, 58, 52), (500, 74, 50, 58), (620, 66, 44, 40)],
               0.08)
    cloud(c, puff_row(rng, 0, W, H + 6, 10, 20), CLOUD_FAR)
    c.save(f'{OUT}/mountains.png')


def layer_islands():
    W, H = 900, 320
    c = Canvas(W, H)
    rng = random.Random(3)
    cx = W // 2
    # far, hazy islands (desktop edges)
    island(c, rng, 30, 60, 50, 26, trees=[(0.45, 6)], far=0.45)
    island(c, rng, 300, 26, 44, 22, trees=[(0.4, 5)], far=0.5)
    island(c, rng, 820, 40, 56, 26, trees=[(0.3, 6), (0.7, 5)], far=0.45)
    # mid-distance islands
    island(c, rng, 120, 150, 110, 58, trees=[(0.2, 9), (0.42, 7)], bushes=2, far=0.12)
    island(c, rng, 700, 196, 120, 60, trees=[(0.22, 8)], ruin=(0.66, 18, 32), bushes=2, far=0.12)
    island(c, rng, 230, 250, 54, 28, trees=[(0.5, 6)], far=0.2)
    # small island top-right of the phone view
    island(c, rng, cx + 84, 22, 76, 34, trees=[(0.25, 9), (0.6, 7)], bushes=1)
    # big island behind the panel: its ends poke out at phone edges
    island(c, rng, cx - 116, 120, 232, 130, trees=[(0.03, 12), (0.11, 9), (0.19, 7)],
           ruin=(0.8, 24, 44), bushes=3, rocks=24)
    c.save(f'{OUT}/islands.png')


if __name__ == '__main__':
    which = sys.argv[2:] or ['sea', 'top', 'mid', 'mountains', 'islands']
    for name in which:
        globals()[f'layer_{name}']()
        print('ok', name)
