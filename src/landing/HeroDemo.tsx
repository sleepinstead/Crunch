import { Stage, Window, type Act, type Layout, type Point } from './kit';
import { Poster } from './Posters';
import './hero-demo.css';

// Crunch's hero: an inspiration board. ⌘V pastes an image under the cursor,
// it is dragged into the row, snaps to the others' tops with equal gaps, and
// ⌘Z twice is the visible cause of the loop's reset.
//
// Plan (stageshow workflow):
//   Medium  loop, ~13s, 1000×470 full-width hero; compact 358×400.
//   Look    light, accent (Crunch blue), standard fidelity.
//   Beats   paste → drag → snap (guides + equal gaps) → hold → ⌘Z ⌘Z.
//   Words   window title, project tabs, the size label. Everything else is art.

type Img = 'none' | 'loading' | 'shown';
type S = { img: Img; pos: Point; selected: boolean; dragging: boolean; guides: boolean };

type Extra = { x: number; y: number; w: number; h: number; kind: 'type' | 'waves' | 'note' | 'sun' };

type Geo = {
  extras: Extra[];
  w: number;
  h: number;
  posters: { x: number; kind: 'sun' | 'arches' | 'grid' }[];
  top: number;
  gap: number;
  target: Point;
  pasteAt: Point;
  rest: Point;
  lineFrom: number;
  lineTo: number;
};

const GEO: Record<Layout, Geo> = {
  wide: {
    // Four equal columns, centred in the window: 4 × 170 + 3 × 30 = 770 of 920.
    // Row two keeps the same columns, sits clear of the size label, and runs
    // down into the fade so the board reads as full, not a strip.
    extras: [
      { x: 115, y: 378, w: 170, h: 200, kind: 'type' },
      { x: 315, y: 378, w: 370, h: 200, kind: 'waves' },
      { x: 715, y: 378, w: 170, h: 112, kind: 'note' },
    ],
    w: 170,
    h: 210,
    top: 112,
    gap: 30,
    posters: [
      { x: 115, kind: 'sun' },
      { x: 315, kind: 'arches' },
      { x: 515, kind: 'grid' },
    ],
    target: { x: 715, y: 112 },
    pasteAt: { x: 610, y: 178 },
    rest: { x: 918, y: 262 },
    lineFrom: 115,
    lineTo: 885,
  },
  compact: {
    extras: [
      { x: 28, y: 246, w: 96, h: 120, kind: 'waves' },
      { x: 144, y: 246, w: 96, h: 72, kind: 'note' },
    ],
    w: 96,
    h: 118,
    top: 96,
    gap: 20,
    posters: [
      { x: 28, kind: 'sun' },
      { x: 144, kind: 'arches' },
    ],
    target: { x: 260, y: 96 },
    pasteAt: { x: 190, y: 150 },
    rest: { x: 300, y: 300 },
    lineFrom: 28,
    lineTo: 356,
  },
};

const initial: S = { img: 'none', pos: GEO.wide.pasteAt, selected: false, dragging: false, guides: false };
const POSTER: S = { img: 'shown', pos: GEO.wide.target, selected: true, dragging: false, guides: true };

async function script(a: Act<S>) {
  const g = GEO[a.layout];
  await a.snap({ pos: g.pasteAt });
  await a.wait(700);

  // 1. Paste under the cursor
  await a.move({ x: g.pasteAt.x + g.w * 0.55, y: g.pasteAt.y + g.h * 0.45 });
  await a.wait(250);
  await a.key('cmd+v');
  await a.set({ img: 'loading', pos: g.pasteAt, selected: false });
  await a.wait(420);
  await a.set({ img: 'shown', selected: true });
  await a.wait(650);

  // 2. Drag it into the row; it snaps when it is close
  const grab = { x: g.w * 0.55, y: g.h * 0.45 };
  await a.drag(
    { x: g.target.x + grab.x, y: g.target.y + grab.y },
    (at) => {
      let pos = { x: at.x - grab.x, y: at.y - grab.y };
      const near = Math.abs(pos.x - g.target.x) < 18 && Math.abs(pos.y - g.target.y) < 18;
      if (near) pos = g.target;
      a.put({ pos, dragging: true, guides: near });
    },
    { duration: 1150 },
  );
  await a.set({ pos: g.target, dragging: false, guides: true });

  // 3. Hold the payoff
  await a.move(g.rest);
  await a.wait(1500);
  await a.set({ guides: false });
  await a.wait(1100);

  // 4. ⌘Z twice: the move, then the paste
  await a.key('cmd+z');
  await a.set({ pos: g.pasteAt });
  await a.wait(650);
  await a.key('cmd+z');
  await a.set({ img: 'none', selected: false });
  await a.wait(800);
}

export function HeroDemo() {
  return (
    <Stage<S>
      width={1000}
      height={540}
      compact={{ below: 640, width: 358, height: 420 }}
      initial={initial}
      poster={POSTER}
      script={script}
      accent="#2383E2"
      keys={{ wide: 'bottom-right', compact: 'bottom' }}
      cursor={{ at: { wide: GEO.wide.rest, compact: GEO.compact.rest } }}
      className="lp-hero-stage"
    >
      {(s, _rect, layout) => {
        const g = GEO[layout];
        const label = `${layout === 'wide' ? 340 : 192} × ${layout === 'wide' ? 420 : 236}`;
        return (
          <>
            <Window title="Moodboard" className="hd2-window">
              <div className="hd2-canvas" data-cursor="pointer" />
              <div className="hd2-dock" aria-hidden>
                <span className="hd2-tab" data-on>
                  Moodboard
                </span>
                <span className="hd2-tab">Brand</span>
                <span className="hd2-tab">Type</span>
                <span className="hd2-dock-sep" />
                <span className="hd2-dock-dot" />
                <span className="hd2-zoom">100%</span>
              </div>
            </Window>

            {g.extras.map((e) => (
              <div key={e.kind + e.x} className={`hd2-item hd2-extra${e.kind === 'note' ? ' hd2-note' : ''}`} style={{ left: e.x, top: e.y, width: e.w, height: e.h }}>
                {e.kind === 'note' ? (
                  <span>
                    Warm, flat shapes.
                    <br />
                    Keep the grain.
                  </span>
                ) : (
                  <Poster kind={e.kind} />
                )}
              </div>
            ))}

            {g.posters.map((p) => (
              <div key={p.kind} className="hd2-item" style={{ left: p.x, top: g.top, width: g.w, height: g.h }}>
                <Poster kind={p.kind} />
              </div>
            ))}

            {/* The pasted image: a placeholder first, then the file itself */}
            <div
              className="hd2-item hd2-new"
              data-target="incoming"
              data-state={s.img}
              data-dragging={s.dragging || undefined}
              style={{ width: g.w, height: g.h, transform: `translate(${s.pos.x}px, ${s.pos.y}px)` }}
            >
              <div className="hd2-shimmer" />
              <Poster kind="bauhaus" />
              <div className="hd2-sel" data-show={(s.selected && s.img === 'shown') || undefined}>
                <i data-c="nw" />
                <i data-c="ne" />
                <i data-c="sw" />
                <i data-c="se" />
                <span className="hd2-size">{label}</span>
              </div>
            </div>

            {/* Snap guides: shared top edge, and equal gaps between neighbours */}
            <div className="hd2-guides" data-show={s.guides || undefined}>
              <div className="hd2-line" style={{ left: g.lineFrom, top: g.top, width: g.lineTo - g.lineFrom }} />
              {[g.posters[g.posters.length - 2], g.posters[g.posters.length - 1]].map((p, i) => {
                const a = p.x + g.w;
                const b = i === 0 ? g.posters[g.posters.length - 1].x : g.target.x;
                return (
                  <div key={i} className="hd2-gap" style={{ left: a, top: g.top + g.h / 2, width: b - a, transitionDelay: `${120 + i * 70}ms` }}>
                    <span>{g.gap * 2}</span>
                  </div>
                );
              })}
            </div>
            <div className="hd2-fade" aria-hidden />
          </>
        );
      }}
    </Stage>
  );
}
