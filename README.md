# Crunch

A local-first inspiration canvas. Paste, drop, and arrange images on an infinite canvas, one canvas per project.

## Run

Requires Node 22.18+ (uses the built-in `node:sqlite` and native TypeScript; no native modules to compile).

```bash
npm install
npm run dev          # http://localhost:3210
```

Production:

```bash
npm run build && npm start
```

`PORT`, `HOST` and `CRUNCH_DATA_DIR` can be set via env.

## Storage

Everything lives in `data/` (or `CRUNCH_DATA_DIR`):

- `data/crunch.db`: SQLite (projects, image metadata, canvas placements)
- `data/images/`: the actual image files, named by content hash

Every image is downloaded and written to disk before it appears on the canvas. Images pasted from a web page,
added by URL, or found via a page's `og:image` are fetched by the server, never hot-linked. The same image added
twice is stored once. Deleting an image from a canvas or deleting a project never removes files from `data/images/`.

Back up `data/` to back up everything.

## Adding images

- **⌘V**: images, copied web images (the original file is downloaded, so GIFs stay animated), image URLs, page URLs
- **Drag & drop**: files from Finder or images from another browser tab
- Right-click the canvas: Paste, Upload, Add from URL

## Controls

| | |
|---|---|
| Drag empty canvas / scroll / Space-drag | Pan |
| ⇧-drag empty canvas | Select area (swappable in Settings) |
| Pinch / ⌘-scroll | Zoom |
| ⇧1 / ⇧0 | Zoom to fit / 100% |
| Double-click image | Focus it |
| Drag corners | Resize (aspect locked) |
| ⌥-drag | Duplicate while moving |
| Drag just outside a corner | Rotate (⇧ snaps to 15°) |
| ⇧R | Rotate 90° |
| ⌘D, ⌘C, ⌫ | Duplicate, copy, delete |
| `[` `]` | Send to back / bring to front |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌥1–9 | Switch project |
| ? | All shortcuts |

Projects are tabs in the floating dock at the bottom: double-click to rename, drag to reorder, right-click to delete.
The swatch button sets the background pattern (dots, grid, plain) and its color.
