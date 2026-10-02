"""Clash Block: the Trivia Clash title face. 9-row pixel glyphs, 3px stems.
Builds fonts/ClashBlock.woff2 and pixel-perfect SVG wordmarks from one glyph table."""
import sys

G = {
'A':["..####..",".######.","###..###","###..###","########","########","###..###","###..###","###..###"],
'B':["#######.","########","###..###","###..###","#######.","########","###..###","########","#######."],
'C':[".#######","########","###.....","###.....","###.....","###.....","###.....","########",".#######"],
'D':["######..","#######.","###..###","###..###","###..###","###..###","###..###","#######.","######.."],
'E':["########","########","###.....","###.....","#######.","#######.","###.....","########","########"],
'F':["########","########","###.....","###.....","#######.","#######.","###.....","###.....","###....."],
'G':[".#######","########","###.....","###.....","###.####","###.####","###..###","########",".#######"],
'H':["###..###"]*4+["########","########"]+["###..###"]*3,
'I':["###"]*9,
'J':[".....###"]*5+["###..###","###..###","########",".######."],
'K':["###..###","###.###.","######..","#####...","#####...","######..","###.###.","###..###","###..###"],
'L':['###...', '###...', '###...', '###...', '###...', '###...', '###...', '######', '######'],
'M':["###...###","####.####","#########","#########","###.#.###","###...###","###...###","###...###","###...###"],
'N':["###..###","####.###","########","########","###.####","###..###","###..###","###..###","###..###"],
'O':[".######.","########","###..###","###..###","###..###","###..###","###..###","########",".######."],
'P':["#######.","########","###..###","###..###","########","#######.","###.....","###.....","###....."],
'Q':['.######..', '########.', '###..###.', '###..###.', '###..###.', '###.####.', '###..####', '########.', '.#####.##'],
'R':["#######.","########","###..###","###..###","#######.","######..","###.###.","###..###","###..###"],
'S':[".#######","########","###.....","#######.",".#######",".....###",".....###","########","#######."],
'T':["#########","#########","#########"]+["...###..."]*6,
'U':["###..###"]*7+["########",".######."],
'V':["###...###"]*4+[".###.###.",".###.###.","..#####..","..#####..","...###..."],
'W':["###...###"]*4+["###.#.###","#########","#########","####.####","###...###"],
'X':["###..###","###..###",".######.","..####..","..####..",".######.","###..###","###..###","###..###"],
'Y':['###...###', '###...###', '###...###', '.#######.', '..#####..', '...###...', '...###...', '...###...', '...###...'],
'Z':["########","########",".....###","....###.","...###..","..###...",".###....","########","########"],
'0':[".######.","########","###..###","###.####","########","####.###","###..###","########",".######."],
'1':["..###.",".####.","#####.","..###.","..###.","..###.","..###.","######","######"],
'2':[".######.","########","###..###",".....###","....####","..#####.",".####...","########","########"],
'3':["#######.","########",".....###","..######","..######",".....###",".....###","########","#######."],
'4':["###..###"]*3+["########","########"]+[".....###"]*4,
'5':["########","########","###.....","#######.","########",".....###",".....###","########","#######."],
'6':[".#######","########","###.....","#######.","########","###..###","###..###","########",".######."],
'7':["########","########",".....###","....###.","...###.."]+["..###..."]*4,
'8':[".######.","########","###..###","########",".######.","###..###","###..###","########",".######."],
'9':[".######.","########","###..###","###..###","########",".#######",".....###","########","#######."],
'!':["###"]*6+["...","###","###"],
'?':[".######.","########","###..###","....####","...####.","...###..","........","...###..","...###.."],
'-':["....."]*4+["#####","#####"]+["....."]*3,
'+':["......."]*2+["..###..","..###.."]+["#######","#######"]+["..###..","..###..","......."],
'.':["..."]*7+["###","###"],
',':["..."]*6+["###","###",".#."],
':':["...","...","###","###","...","...","###","###","..."],
"'":["###","###",".#."]+["..."]*6,
'#':[".##..##.",".##..##.","########",".##..##.",".##..##.",".##..##.","########",".##..##.",".##..##."],
'&':[".#####..","###.###.","###.###.",".#####..","#######.","###.####","###..##.","########",".######."],
}
SPACE_W = 4

# ---------- font ----------
def build_font(path):
    from fontTools.fontBuilder import FontBuilder
    from fontTools.pens.ttGlyphPen import TTGlyphPen
    P = 100  # font units per glyph pixel; cap height 900, UPM 1000 -> 1px = font-size/10
    names = {ch: ('uni%04X' % ord(ch)) for ch in G}
    order = ['.notdef', 'space'] + [names[c] for c in G]
    fb = FontBuilder(1000, isTTF=True)
    fb.setupGlyphOrder(order)
    cmap = {32: 'space'}
    for ch in G:
        cmap[ord(ch)] = names[ch]
        if ch.isalpha(): cmap[ord(ch.lower())] = names[ch]
    fb.setupCharacterMap(cmap)
    glyphs, metrics = {}, {}
    def empty():
        return TTGlyphPen(None).glyph()
    glyphs['.notdef'] = empty(); metrics['.notdef'] = (600, 0)
    glyphs['space'] = empty(); metrics['space'] = (SPACE_W * P, 0)
    for ch, rows in G.items():
        pen = TTGlyphPen(None)
        for r, row in enumerate(rows):
            x = 0
            while x < len(row):
                if row[x] == '#':
                    x1 = x
                    while x1 < len(row) and row[x1] == '#': x1 += 1
                    xa, xb = x * P, x1 * P
                    yt, yb = (9 - r) * P, (8 - r) * P
                    pen.moveTo((xa, yb)); pen.lineTo((xa, yt)); pen.lineTo((xb, yt)); pen.lineTo((xb, yb)); pen.closePath()
                    x = x1
                else:
                    x += 1
        glyphs[names[ch]] = pen.glyph()
        metrics[names[ch]] = ((len(rows[0]) + 1) * P, 0)
    fb.setupGlyf(glyphs)
    fb.setupHorizontalMetrics(metrics)
    fb.setupHorizontalHeader(ascent=1000, descent=-200)
    fb.setupNameTable({'familyName': 'Clash Block', 'styleName': 'Regular',
                       'uniqueFontIdentifier': 'ClashBlock-Regular', 'fullName': 'Clash Block',
                       'psName': 'ClashBlock-Regular', 'version': 'Version 1.000'})
    fb.setupOS2(sTypoAscender=1000, sTypoDescender=-200, usWinAscent=1000, usWinDescent=200,
                sCapHeight=900, sxHeight=900)
    fb.setupPost()
    fb.font.flavor = 'woff2'
    fb.save(path)

# ---------- wordmark svg ----------
S, PAD, EXT, LINEGAP = 2, 3, 3, 6
BAND = ['#fff3b8','#ffe46a','#ffd23a','#ffc92e','#ffc92e','#ffb81f','#f5a300','#e89200','#d98200']

# Pairs whose empty corners interlock; negative = pull together (glyph px).
KERN = {('L', 'Y'): -2, ('L', 'T'): -2, ('T', 'A'): -1, ('A', 'T'): -1}


def word_cols(word):
    placed, x = [], 0
    for i, ch in enumerate(word):
        if ch == ' ':
            x += SPACE_W
            continue
        if i:
            x += 1 + KERN.get((word[i - 1], ch), 0)
        placed.append((x, G[ch]))
        x += len(G[ch][0])
    cols = [None] * x
    for gx, g in placed:
        for cx in range(len(g[0])):
            col = [g[y][cx] for y in range(9)]
            if cols[gx + cx] is None:
                cols[gx + cx] = col
            else:
                cols[gx + cx] = ['#' if '#' in (a, b) else '.' for a, b in zip(cols[gx + cx], col)]
    return cols


def wordmark_svg(lines, scale=4):
    lines = [word_cols(w) for w in lines]
    Wg = max(len(l) for l in lines)
    W = Wg * S + 2 * PAD
    H = len(lines) * 9 * S + (len(lines) - 1) * LINEGAP + EXT + 2 * PAD
    F = {}
    for li, l in enumerate(lines):
        off = (Wg - len(l)) // 2
        oy = PAD + li * (9 * S + LINEGAP)
        for gx, col in enumerate(l):
            if col is None: continue
            for gy, c in enumerate(col):
                if c == '#':
                    for dx in range(S):
                        for dy in range(S):
                            F[(PAD + (off + gx) * S + dx, oy + gy * S + dy)] = gy
    E = {(x, y + k) for (x, y) in F for k in range(1, EXT + 1) if (x, y + k) not in F}
    body = set(F) | E
    col = {}
    for (x, y) in body:
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1): col[(x + dx, y + dy)] = '#0a0a0f'
    for p in E: col[p] = '#7a3e00'
    for (x, y), gy in F.items():
        c = BAND[gy]
        if (x, y - 1) not in F: c = '#fffbe6'
        elif (x - 1, y) not in F: c = '#ffe89c' if gy < 5 else c
        elif (x + 1, y) not in F or (x, y + 1) not in F: c = '#c46a00'
        col[(x, y)] = c
    rects = []
    ys = sorted({y for (_, y) in col})
    for y in ys:
        xs = sorted(x for (x, yy) in col if yy == y); i = 0
        while i < len(xs):
            x0 = xs[i]; c = col[(x0, y)]; j = i
            while j + 1 < len(xs) and xs[j + 1] == xs[j] + 1 and col[(xs[j + 1], y)] == c: j += 1
            rects.append(f'<rect x="{x0}" y="{y}" width="{xs[j]-x0+1}" height="1" fill="{c}"/>'); i = j + 1
    vw, vh = W + 2, H + 2
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 {vw} {vh}" width="{vw*scale}" '
            f'height="{vh*scale}" shape-rendering="crispEdges">' + ''.join(rects) + '</svg>'), (vw, vh)

if __name__ == '__main__':
    out = sys.argv[1]
    build_font(f'{out}/ClashBlock.woff2')
    for name, lines in [('super-questly-wordmark', ['SUPER', 'QUESTLY']),
                        ('round-scores-title', ['ROUND', 'SCORES'])]:
        svg, size = wordmark_svg(lines)
        open(f'{out}/{name}.svg', 'w').write(svg)
        print(name, size)
