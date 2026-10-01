# Pixel art generators

Source for the Super Questly pixel artwork (STE-128 redesign). Everything here is
drawn in code, so the art can be tweaked and regenerated instead of hand-edited.
The same files are published in the design system (Claude Design: "Super Questly
Design System").

| Script          | Makes                                                                                                                            | Output in the app             |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `clashblock.py` | **Clash Block** title font (`ClashBlock.woff2`) and the title wordmarks (`super-questly-wordmark.svg`, `round-scores-title.svg`) | `client/public/brand/`        |
| `world.py`      | The sky world background, five tiling layers: `top`, `mid`, `mountains`, `islands`, `sea`                                        | `client/public/world/`        |
| `compose.py`    | A preview of the layered world at any viewport size, matching `.tc-world` in `pixel.css`                                         | (preview only)                |
| `og.py`         | The social share image                                                                                                           | `client/public/opengraph.jpg` |

## Setup

```bash
python3 -m venv .venv-pixel-art && .venv-pixel-art/bin/pip install -r scripts/pixel-art/requirements.txt
```

## Regenerate

```bash
.venv-pixel-art/bin/python scripts/pixel-art/world.py client/public/world
.venv-pixel-art/bin/python scripts/pixel-art/clashblock.py client/public/brand
.venv-pixel-art/bin/python scripts/pixel-art/og.py client/public/world client/public/opengraph.jpg
```

`world.py` also takes layer names to rebuild just those (`... client/public/world islands`).
Preview a viewport: `.venv-pixel-art/bin/python scripts/pixel-art/compose.py client/public/world 390 844 /tmp/phone.png`.

## How the world fits every screen

Each layer is drawn at native size and shown at 2 CSS px per art pixel with
`image-rendering: pixelated`. Layers repeat horizontally and are anchored, never
scaled, so wider screens reveal more islands and clouds instead of stretching.
The centre of the islands tile is composed for a phone: the big island's ends
(trees on the left, castle on the right) poke out past the game panel. If you
move or resize a layer, update the matching `background-size` /
`background-position` in `client/src/components/pixel/pixel.css` and `compose.py`.

Output is deterministic (fixed random seeds): rerunning without changes produces
identical files.
