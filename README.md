# unghost

**Read the Ghost Font — in the browser, from a single paused frame.**

[Ghost Font](https://www.mixfont.com/ghost-font) calls itself *"an anti-AI font that can be read by
humans but not leading AI models."* It hides text inside a field of scrolling noise dots: the dots
inside the glyph mask drift **up**, the background dots drift **down**, and to the human eye the
letters emerge from the motion.

unghost reads it back — and ships a skill so AI can learn to read it too. As a piece of performance
art, it completes the loop Ghost Font started: not just breaking the "AI can't read this" claim, but
*teaching* AI to break it.

**Live demo → [a7t.ink/unghost](https://a7t.ink/unghost)**

---

## The crack

The encoder never special-cases the glyph boundary, and that single omission leaks the message into
every frame.

1. **Shared lattice, split motion.** The two dot layers share a horizontal grid phase and differ
   only vertically. Where they overlap they fuse into solid `3×4 / 3×5 / 3×6` blocks — pure interior
   noise that carries no edge information.

2. **Union-erase.** Erase every pixel covered by *any* solid `k×k` dark block. All interior dots
   vanish; only the clipped fragments along the glyph boundary survive — and they trace the outline.
   No motion tracking, no multi-frame registration. One frame is enough.

3. **Read the outline.** A human reads it directly. For automation, match each glyph against outline
   templates of the known charset (`A–Z 0–9`) with normalized cross-correlation, then vote across
   frames to shrug off compression noise.

> The faint bands at the top and bottom edges are structural — dots entering and leaving the canvas
> leave partial blocks behind. They are **not** the low-opacity *"WRITTEN IN GHOST FONT"* decoy; that
> layer vanishes at the binarization threshold and never reaches the pipeline.

## Try it

Open **[a7t.ink/unghost](https://a7t.ink/unghost)** and drop a Ghost Font screenshot or video — or
just hit *Decode the sample clip*. Everything runs locally; nothing is uploaded.

To run it yourself:

```bash
cd docs && python3 -m http.server 8000   # any static server works
# open http://localhost:8000
```

## Teach an AI

This repo is an installable [skill](https://github.com/vercel-labs/skills). The skill walks an agent
through recovering the outline and **reading it with its own vision** — the natural route for a
multimodal model — falling back to classical template OCR only if it can't view images.

```bash
npx skills add A7T/unghost
```

Then hand your agent a Ghost Font clip and ask it to read the hidden message.

## Layout

```
SKILL.md              the skill (npx skills add A7T/unghost)
docs/                 the web app (GitHub Pages source)
  index.html          page
  app.js              intake, rendering, wiring
  decoder.js          union-erase + outline-template OCR (no dependencies)
  fonts/              Geist Pixel (display type, matching the original site)
  media/ghost.mp4     sample clip ("SEND NUDES")
```

## Roadmap

- **In-browser CNN recognizer.** The same idea learned end-to-end — a tiny model trained on synthetic
  Ghost Font renders (we control the encoder, so labeled data is free), running client-side over
  WASM/WebGPU. More robust to rescaled / subpixel input than the hand-tuned templates.

## Credits

- [Ghost Font](https://www.mixfont.com/ghost-font) by Mixfont — the original experiment. unghost is a
  counter-demonstration, not affiliated.
- Display type: Geist Pixel (Vercel), used to echo the original site's aesthetic.
