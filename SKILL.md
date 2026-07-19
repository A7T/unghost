---
name: unghost
description: Decode the Ghost Font (mixfont.com/ghost-font) — recover the hidden message from a screenshot or video of the "anti-AI font". Use when the user provides Ghost Font media or asks to read text hidden by moving noise dots.
---

# unghost — read the Ghost Font

Ghost Font hides text by scrolling the noise dots **inside** the glyph mask upward while the
background dots scroll downward. The two layers share a horizontal lattice phase and differ only
vertically, so where they overlap they fuse into solid `3×4 / 3×5 / 3×6` blocks that carry **no edge
information**. Along the glyph boundary the moving mask clips dots into partial (non-3×3) fragments.

That single design choice leaks the letters into every frame. Recover the outline, then read it.

## When to use

- The user gives you a screenshot or video from `mixfont.com/ghost-font` (or a matching look:
  a light field of scrolling dark dots with faint structure).
- The user asks to "read", "decode", "crack", or "unghost" such media.

## Method

### 1. Get a frame (or several)

- **Video**: sample a handful of frames spread across the clip. The message is constant; frames
  differ only in noise. Any frame extractor works (`ffmpeg -i in.mp4 out%03d.png`, OpenCV, etc.).
- **Screenshot**: use it directly. One frame is enough.

### 2. Recover the glyph outline — union-erase

Binarize the frame (`dark = pixel < threshold`, threshold ≈ 128). Then erase **every pixel covered by
any solid k×k dark block** (k ≈ dot size, 3 px for the original 1280×720 export). The surviving
pixels are the clipped fragments along the glyph boundary — they trace the outline.

```python
import numpy as np, cv2

def union_erase(gray, thr=128, k=3):
    dark = (gray < thr).astype(np.uint8)
    win = cv2.boxFilter(dark.astype(np.float32), -1, (k, k),
                        anchor=(1, 1), normalize=False,
                        borderType=cv2.BORDER_CONSTANT)
    solid = (win == k * k).astype(np.uint8)     # centers of solid k×k windows
    interior = cv2.dilate(solid, np.ones((k, k), np.uint8))
    outline = dark.copy(); outline[interior > 0] = 0
    return outline                              # bright = glyph boundary
```

Render the outline as a high-contrast image (bright outline on black). The letters become clearly
legible.

### 3. Read it — prefer your own vision

**Primary path (multimodal):** once you have the clean outline image, **read it yourself**. The
outline is ordinary uppercase text (Arial Black, charset `A–Z 0–9 .,!?&-'`, ≤ 36 chars, possibly
wrapped onto two lines). A multimodal model reads this far more robustly than classical OCR — this is
the right move, not a shortcut.

**Fallback (classical OCR):** if you cannot view images, do template matching — project to find line
bands, segment characters on the *raw* outline (so adjacent letters keep their gap), then match each
glyph against outline templates of the known charset with normalized cross-correlation. A complete
zero-dependency implementation lives in `docs/decoder.js` (`ocrFrame`) in this repo.

### 4. Vote across frames (video only)

Compression noise corrupts individual frames. Decode several frames independently and take a
per-position majority vote to clean up stragglers.

## Gotchas

- **The decoy caption is a red herring.** The low-opacity "WRITTEN IN GHOST FONT" layer vanishes at
  the binarization threshold and never reaches this pipeline. The faint bands at the top/bottom edges
  are structural (dots entering/leaving the canvas), not the decoy.
- **Don't try to read the raw noise directly.** A single paused frame looks like static; the signal
  only appears after union-erase.
- **Rescaled / subpixel input.** If the screenshot is not native 1280×720, the 3×3 assumption breaks.
  Estimate the dot period and resample, or adjust `k`. The browser tool exposes threshold and period
  controls for exactly this.

## Browser tool

This repo ships a zero-dependency web app (`docs/`) that does all of the above locally: drop a clip
or screenshot → it extracts the outline and reads it (multi-frame vote for video). Serve `docs/`
over HTTP and open `index.html`, or use the hosted version at https://a7t.ink/unghost .
