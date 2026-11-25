# Crunch

Crunch is a place to collect visual references. You paste or drop images onto an endless canvas, move them around
until the board feels right, and keep each project on its own board. Everything stays on your computer: no account,
no cloud, and it works offline.

Saving inspiration usually ends up as a folder of screenshots or a bookmarking site that holds your files for you.
Crunch keeps the originals in a folder you control and gives you a proper canvas to arrange them on.

<!-- Screenshot: a full board with a few images and a text note -->
![A Crunch board](docs/screenshot-board.png)

## What it does

- **Paste anything.** Copy an image, an image link or a web page and press ⌘V. Crunch downloads the full file, so
  GIFs stay animated and nothing breaks when the original site goes away.
- **Arrange like a design tool.** Move, resize and rotate images. Things snap to each other's edges and to even
  spacing as you drag.
- **Layers and groups.** Group related images, name them, lock or hide them from the Layers panel.
- **Text notes.** Add a few words next to your references.
- **One board per project.** Boards live as tabs in the dock at the bottom. Each has its own background colour and
  pattern.
- **Recently deleted.** Deleted images and notes wait there until you restore them or clear them out.
- **Export and import.** Save your whole library as a single `.crunch` file and bring it back on any machine.

## Getting started

You need Node.js 22.18 or newer.

```bash
npm ci
npm run dev
```

Then open http://localhost:3210. The first time, a quick tour shows you around; you can see it again from
Settings › Help.

To run it the way you would day to day:

```bash
npm run build
npm start
```

<!-- Screenshot: the dock with board tabs and the Layers panel open -->
![Boards, layers and the dock](docs/screenshot-layers.png)

## Everyday shortcuts

| Shortcut | What it does |
|---|---|
| ⌘V | Paste images or links |
| Space + drag, or scroll | Move around the canvas |
| ⌘ + scroll, or pinch | Zoom |
| ⌘G / ⇧⌘G | Group / ungroup |
| ⌘D | Duplicate |
| ⌘Z / ⇧⌘Z | Undo / redo |
| ⌥1–9 | Switch boards |
| ? | Show every shortcut |

Double-click a board tab to rename it, drag to reorder, right-click to delete.

## Where your files live

Everything is saved in the `data` folder inside the project:

- `crunch.db` holds your boards, layers and settings.
- `images/` holds the image files themselves. The same image added twice is only stored once.
- `backups/` keeps a daily copy of the database, plus any image you delete for good, for two weeks.

To move your library, use **Settings › Library › Export**, then **Import** on the other machine. Importing adds
boards next to the ones you already have and never overwrites anything.

<!-- Screenshot: Settings panel showing Export and Import -->
![Export and import in Settings](docs/screenshot-settings.png)

## A few more things

- Crunch only listens on your own machine by default. If you change `HOST` to share it on a network, you also have
  to set `CRUNCH_TOKEN`.
- `PORT` and `CRUNCH_DATA_DIR` let you change the port and keep the library somewhere else.

## License

MIT
