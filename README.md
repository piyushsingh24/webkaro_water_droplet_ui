# Rainy Notes — Clone

Cloned from https://woyeaq6rs2wvq.ok.kimi.link/ — a shader-rendered rainy window you can write notes on.

## Structure
```
index.html      # main page (canvas + notes + panel + gallery)
style.css       # original styles (Geist fonts, glass UI, gallery, etc.)
app.js          # vanilla JS port — WebGL2 rain shader + notes + UI
assets/tokyo-evening.jpg  # background photo
```

## Features cloned
- **WebGL2 rain shader** (full `Pm` fragment shader, `Im` vertex shader): spherical-cap drops, sag/wobble, runners with trails, beading octaves, refraction, dispersion, specular sheen, lightning, grain, vignette
- **Notes**: multiple notes, `localStorage` persistence (`rainy-notes`), editable `plaintext-only` sheet, text rendered to mask canvas to wipe rain where you write
- **Controls panel** (P to toggle):
  - Weather presets: Drizzle / Shower / Downpour / Storm / Fogged
  - Backgrounds: Tokyo (photo), Neon & Dusk (procedural canvas), + custom upload (and drag-drop)
  - Sliders: Rain (Density, Speed, Drop size, Trails, Wind, Scale), Glass (Condensation, Refraction, Dispersion, Sheen, Defocus), Scene (Zoom, Parallax, Exposure, Lightning, Grain), Render (Resolution), Text size
  - Text colours (8 swatches), Reset effects
  - Files list + Gallery (S to toggle)
- **Shortcuts**: `P` panel, `S` gallery, `H` hide UI, `Esc` close, `drop` image onto page

## Run
Just open `index.html` in a modern browser (Chrome/Safari/Firefox with hardware acceleration). For best image loading, serve via a local server:

```bash
# Python
python -m http.server 8000
# then open http://localhost:8000/

# or Node
npx serve .
```

No build step, no dependencies — `app.js` is a plain ES module.

## Notes
- Uses `localStorage` keys `rainy-notes`, `rainy-notes:state`, `rainy-notes:upload` to stay compatible with original.
- WebGL2 required — if unavailable, a “This page needs WebGL2” message shows.
- Fonts loaded from `cdn.jsdelivr.net` (Geist Variable).

Original shader and logic ported from the site’s bundle `index-B38XnjQX.js` / `index-LSlUj0YS.css`.
