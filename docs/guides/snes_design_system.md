# SNES Cloud Kingdom Design System

Reference guide for the retro SNES-inspired UI theme used across the Trivia Clash app.

**Import path:** `@/components/snes`

**Required fonts** (loaded in `client/index.html`):

- [Luckiest Guy](https://fonts.google.com/specimen/Luckiest+Guy) — SVG title only
- [Press Start 2P](https://fonts.google.com/specimen/Press+Start+2P) — BevelButton text
- Impact (system font) — panel headers, labels, status text

---

## Color Palette

| Token                | Hex                           | Usage                          |
| -------------------- | ----------------------------- | ------------------------------ |
| `SNES_COLORS.red1`   | `#ff655d`                     | Button gradient top (red)      |
| `SNES_COLORS.red2`   | `#df2e36`                     | Button gradient mid (red)      |
| `SNES_COLORS.red3`   | `#a80e18`                     | Button gradient bottom (red)   |
| `SNES_COLORS.green1` | `#74ec57`                     | Button gradient top (green)    |
| `SNES_COLORS.green2` | `#39bf36`                     | Button gradient mid (green)    |
| `SNES_COLORS.green3` | `#1f7d25`                     | Button gradient bottom (green) |
| Panel blue           | `#4565df → #2f57c9 → #234ebd` | Panel background gradient      |
| Panel border         | `#111`                        | Panel outer border             |
| Panel glow           | `#dfe6ff`                     | Inner glow (4px inset)         |
| Sky top              | `#1f78e4`                     | Sky gradient start             |
| Sky mid              | `#4aa6ff`                     | Sky gradient middle            |
| Sky bottom           | `#d6f0ff`                     | Sky gradient end               |

---

## Typography Styles

### `pixelText` — Panel headers and labels

- Font: Impact (via `FONT_STACKS.display`)
- Uppercase, 1px letter spacing
- White text with `2px #11204d` text-stroke
- `4px` downward text shadow

### `FONT_STACKS.pixel` — BevelButton text

- Font: `'Press Start 2P', cursive`
- Used exclusively inside `BevelButton` component
- White text with 8-directional outline via `text-shadow`

### `FONT_STACKS.title` — SVG title

- Font: `'Luckiest Guy', sans-serif`
- 4-layer SVG technique: shadow → extrusion → outline → gold gradient face

---

## Components

### `CloudKingdomBg`

Full-page background scene with clouds, floating islands, and bottom haze.

```tsx
import { CloudKingdomBg, SKY_GRADIENT } from '@/components/snes';

<main style={{ background: SKY_GRADIENT }}>
  <CloudKingdomBg />
  {/* page content with z-10 */}
</main>;
```

### `BevelButton`

Primary CTA button with Press Start 2P font, two-tone gradient, and 3D bevel.

```tsx
import { BevelButton } from '@/components/snes';

// Gold (Quick Play)
<BevelButton
  bgTop="#fdd835" bgBottom="#e08a0e" borderColor="#8b5e0a"
  highlightColor="rgba(255,245,180,.55)" shadowColor="rgba(120,70,0,.5)"
  width="60%" height={86} fontSize={20}
>
  QUICK PLAY
</BevelButton>

// Green (Admin)
<BevelButton
  bgTop="#5cdb5c" bgBottom="#238b23" borderColor="#145214"
  highlightColor="rgba(200,255,200,.45)" shadowColor="rgba(10,60,10,.5)"
  width="38%" height={56} fontSize={14}
>
  ADMIN
</BevelButton>

// Red (destructive)
<BevelButton
  bgTop="#ff655d" bgBottom="#a80e18" borderColor="#5b0005"
  highlightColor="rgba(255,200,200,.4)" shadowColor="rgba(80,0,0,.5)"
  width={120} height={48} fontSize={12}
>
  DELETE
</BevelButton>
```

### `GamePanel` / `GamePanelHeader`

Blue gradient content container with optional section header.

```tsx
import { GamePanel, GamePanelHeader } from '@/components/snes';

<GamePanel className="w-11/12 max-w-md flex flex-col z-10">
  <GamePanelHeader>TEAM SETUP</GamePanelHeader>
  {/* panel content */}
</GamePanel>;
```

### `CSSAvatar`

32×32 CSS-only character sprite with colored cap.

```tsx
import { CSSAvatar, CAP_COLORS } from '@/components/snes';

<CSSAvatar capColor={CAP_COLORS[index % CAP_COLORS.length]} />;
```

### `StatusOrb`

14px red radial-gradient status indicator.

```tsx
import { StatusOrb } from '@/components/snes';

<StatusOrb />;
```

---

## Panel Styles (raw tokens)

For custom panel layouts, import the style objects directly:

```tsx
import { gamePanel, panelHeader, teamRow, btnBase, pixelText } from '@/components/snes';

// Apply as inline styles
<div style={{ ...teamRow, minHeight: 64, padding: '10px 12px' }}>
  <span style={{ ...pixelText, fontSize: 12 }}>LABEL</span>
  <button style={{ ...btnBase, background: '...' }}>ACTION</button>
</div>;
```

---

## Building a New Screen

1. Set `<main>` background to `SKY_GRADIENT`
2. Add `<CloudKingdomBg />` as the first child
3. Use `z-10` on all content elements to layer above the background
4. Wrap content sections in `<GamePanel>` with `<GamePanelHeader>`
5. Use `<BevelButton>` for primary actions
6. Apply `pixelText` style for labels and headings
7. Use `btnBase` spread for in-panel action buttons (REMOVE, ADD, etc.)

---

## SVG Title Technique

The "TRIVIA CLASH" title uses a 4-layer SVG text approach for the 3D effect:

1. **Shadow layer** — dark fill + thick stroke, offset down 22px
2. **Extrusion layer** — medium blue fill + thick stroke, offset down 11px
3. **Outline layer** — dark fill + thin stroke, at baseline
4. **Face layer** — gold gradient fill, at baseline

The gold gradient: `#ffee73 → #ffc824 → #fa9c00 → #e36300`

See `Home.tsx` header section for the full SVG markup.
