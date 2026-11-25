import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Collapse, Stage, useReducedMotion, type Act } from './kit';
import { Poster, type PosterKind } from './Posters';
import './bento.css';

// Crunch's feature grid (stageshow references/bento.md), hero and strip.
//
//   Tile       Span   Kind        The one thing                         Moves
//   Layers     2 × 1  Hero UI     three layers selected, ⌘G groups them  rows select, the group forms on canvas too
//   Local      1 × 1  Stat        "100%" on the one dark tile            counts up once
//   Paste      1 × 1  Statement   "Paste a link, keep the original."     the keycaps press once
//   Color      1 × 1  Object      the colour picker itself               the thumb glides, the swatch follows
//   Snap       1 × 1  Diagram     three frames, one snapping into line   slides in, guides + gaps appear
//
// One window-ish surface (the Layers panel). Neighbours differ across and
// down. Each picture is its own Stage at 1:1; copy is page text. Each tile
// plays one beat, once, as the grid scrolls in, 110ms apart in reading order.

const STEP = 110;
const LEAD = 450;

function usePictureWidth(initial = 340) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(initial);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setWidth(Math.max(1, Math.round(node.getBoundingClientRect().width)));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function useInView<T extends Element>(delay: number) {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let t = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        t = window.setTimeout(() => setSeen(true), delay);
      },
      { threshold: 0.45 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(t);
    };
  }, [delay]);
  return [ref, seen] as const;
}

function Tile({ area, title, children, picture, dark }: { area: string; title?: ReactNode; children?: ReactNode; picture?: ReactNode; dark?: boolean }) {
  return (
    <section className={`cb-tile cb-tile--${area}`} data-dark={dark || undefined}>
      {title ? (
        <p className="cb-copy">
          {title} {children}
        </p>
      ) : (
        children
      )}
      {picture}
    </section>
  );
}

/* ---------------- Layers (hero) ---------------- */

type LayersS = { sel: number; grouped: boolean };
const LAYERS: { name: string; kind: PosterKind }[] = [
  { name: 'Bauhaus', kind: 'bauhaus' },
  { name: 'Arches', kind: 'arches' },
  { name: 'Sun', kind: 'sun' },
];

async function layersScript(a: Act<LayersS>) {
  await a.wait(LEAD);
  for (let i = 0; i < 3; i++) {
    await a.set({ sel: i + 1 });
    await a.wait(90);
  }
  await a.wait(420);
  await a.key('cmd+g');
  await a.set({ grouped: true });
  await a.wait(2400);
  // The reset has a visible cause: ungroup, then the selection clears.
  await a.key('shift+cmd+g');
  await a.set({ grouped: false });
  await a.wait(500);
  await a.set({ sel: 0 });
  await a.wait(900);
}

function Layers() {
  const [picture, width] = usePictureWidth(640);
  const wide = width >= 520;
  return (
    <Tile
      area="hero"
      title={<b>Layers, groups and locks.</b>}
      picture={
        <div ref={picture} className="cb-picture cb-picture--hero">
          <Stage<LayersS>
            width={width}
            height={wide ? 300 : 330}
            initial={{ sel: 0, grouped: false }}
            poster={{ sel: 3, grouped: true }}
            play="loop"
            script={layersScript}
            keys="bottom-right"
            className="cb-stage cb-layers-stage"
          >
            {(s) => (
              <div className="cb-layers" data-wide={wide || undefined}>
                <div className="cb-panel">
                  <div className="cb-tabs">
                    <span data-on>Layers</span>
                    <span>Design</span>
                  </div>
                  <Collapse open={s.grouped}>
                    <div className="cb-row cb-row--group" data-sel={s.grouped || undefined}>
                      <svg className="cb-chev" viewBox="0 0 12 12" width="12" height="12" aria-hidden>
                        <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                      <span className="cb-thumb cb-thumb--frame">#</span>
                      <span className="cb-name">Moodboard</span>
                    </div>
                  </Collapse>
                  {LAYERS.map((l, i) => (
                    <div key={l.name} className="cb-row" data-sel={(!s.grouped && s.sel > i) || undefined} data-child={s.grouped || undefined}>
                      <span className="cb-thumb">
                        <Poster kind={l.kind} />
                      </span>
                      <span className="cb-name">{l.name}</span>
                    </div>
                  ))}
                  <div className="cb-row">
                    <span className="cb-thumb cb-thumb--text">T</span>
                    <span className="cb-bar" style={{ width: 74 }} />
                  </div>
                  <div className="cb-row">
                    <span className="cb-thumb cb-thumb--plain" />
                    <span className="cb-bar" style={{ width: 58 }} />
                  </div>
                </div>

                {wide && (
                  <div className="cb-board">
                    {LAYERS.map((l, i) => (
                      <div key={l.name} className={`cb-board-item cb-board-item--${i}`} data-sel={(!s.grouped && s.sel > i) || undefined}>
                        <Poster kind={l.kind} />
                      </div>
                    ))}
                    <div className="cb-board-group" data-show={s.grouped || undefined}>
                      <span>Moodboard</span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Stage>
        </div>
      }
    >
      Arrange a board the way you would in a design tool.
    </Tile>
  );
}

/* ---------------- Local (stat) ---------------- */

function Local() {
  const reduced = useReducedMotion();
  const [ref, seen] = useInView<HTMLDivElement>(LEAD + STEP);
  const on = seen || reduced;
  return (
    <Tile area="stat" dark>
      <div ref={ref} className="cb-own" data-on={on || undefined}>
        <span className="cb-own-kicker">Private by design</span>
        <p className="cb-own-lines">
          <span style={{ transitionDelay: '0ms' }}>No account.</span>
          <span style={{ transitionDelay: '110ms' }}>No cloud.</span>
          <span className="cb-own-accent" style={{ transitionDelay: '220ms' }}>
            Just your files.
          </span>
        </p>
        <span className="cb-own-note">Boards and images live on your computer, and work offline.</span>
        <span className="cb-path" aria-label="Crunch, data, images">
          <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden>
            <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h6a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1Z" fill="currentColor" />
          </svg>
          <span>Crunch</span>
          <i>›</i>
          <span>data</span>
          <i>›</i>
          <b>images</b>
        </span>
      </div>
    </Tile>
  );
}

/* ---------------- Paste (statement) ---------------- */

function Paste() {
  const [ref, seen] = useInView<HTMLDivElement>(LEAD + STEP * 2);
  return (
    <Tile area="paste">
      <div ref={ref} className="cb-statement" data-on={seen || undefined}>
        <span className="cb-keys" aria-hidden>
          <kbd>⌘</kbd>
          <kbd>V</kbd>
        </span>
        <p>
          <b>Paste a link, keep the original.</b> <span>Crunch downloads the full file, so GIFs stay animated.</span>
        </p>
      </div>
    </Tile>
  );
}

/* ---------------- Color (object) ---------------- */

// The eyedropper story: the dropper is armed, a loupe samples the poster's
// orange, the picker glides to it; clicking the blue swatch is the reset.
type ColorS = { on: boolean; dropper: boolean; loupe: boolean; swatch: boolean };
const COLOR_SWATCHES = ['#2383E2', '#E8603C', '#F2B33D', '#1F3D33', '#191919', '#F7F7F5'];
const colorScript = (i: number) => async (a: Act<ColorS>) => {
  await a.wait(LEAD + i * STEP);
  await a.set({ dropper: true });
  await a.wait(380);
  await a.set({ loupe: true });
  await a.wait(700);
  await a.set({ on: true, loupe: false, dropper: false });
  await a.wait(2600);
  await a.set({ swatch: true });
  await a.wait(160);
  await a.set({ on: false, swatch: false });
  await a.wait(1800);
};

function Color() {
  return (
    <Tile
      area="color"
      title={<b>Colours, picked properly.</b>}
      picture={
        <div className="cb-picture cb-picture--center">
          <Stage<ColorS>
            width={360}
            height={210}
            initial={{ on: false, dropper: false, loupe: false, swatch: false }}
            poster={{ on: true, dropper: false, loupe: false, swatch: false }}
            play="loop"
            script={colorScript(3)}
            className="cb-stage"
          >
            {(s) => (
              <div className="cb-color" data-on={s.on || undefined}>
                <div className="cb-color-art">
                  <Poster kind="sun" />
                  <i className="cb-loupe" data-show={s.loupe || undefined} />
                </div>
                <div className="cb-picker">
                  <div className="cb-sv">
                    <i className="cb-sv-thumb" />
                  </div>
                  <div className="cb-tools">
                    <span className="cb-dropper" data-on={s.dropper || undefined}>
                      <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden>
                        <path
                          d="m9.6 3.3 3.1 3.1M11.2 1.8a1.6 1.6 0 0 1 2.3 2.3L11.9 5.7l-1.6-1.6ZM10.4 5 4 11.4l-.6 2.2 2.2-.6L12 6.6"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.4"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </span>
                    <div className="cb-hue">
                      <i className="cb-hue-thumb" />
                    </div>
                  </div>
                  <div className="cb-fill">
                    <span className="cb-chip" />
                    <span className="cb-hex">
                      <span className="cb-hex-a">2383E2</span>
                      <span className="cb-hex-b">E8603C</span>
                    </span>
                    <span className="cb-alpha">100%</span>
                  </div>
                  <div className="cb-swatches">
                    {COLOR_SWATCHES.map((c, i) => (
                      <i key={c} style={{ background: c }} data-i={i} data-press={(s.swatch && i === 0) || undefined} />
                    ))}
                  </div>
                </div>
              </div>
            )}
          </Stage>
        </div>
      }
    >
      A picker beside every colour, with an eyedropper.
    </Tile>
  );
}

/* ---------------- Snap (diagram) ---------------- */

type SnapS = { on: boolean };
const snapScript = async (a: Act<SnapS>) => {
  await a.wait(LEAD + 4 * STEP + 700);
  await a.set({ on: true });
  await a.wait(2800);
  await a.set({ on: false });
  await a.wait(1300);
};

function Snap() {
  const [picture, width] = usePictureWidth();
  // Three frames and two gaps fill the picture's width (gap = 30% of a frame).
  const box = Math.round(Math.min(width, 420) / 3.6);
  const gap = Math.round(box * 0.3);
  const x0 = 0;
  const xs = [x0, x0 + box + gap, x0 + 2 * (box + gap)];
  return (
    <Tile
      area="snap"
      title={<b>Snaps into place.</b>}
      picture={
        <div ref={picture} className="cb-picture cb-picture--aligned">
          <Stage<SnapS> width={width} height={190} initial={{ on: false }} poster={{ on: true }} play="loop" script={snapScript} className="cb-stage">
            {(s) => (
              <div className="cb-snap" data-on={s.on || undefined} style={{ ['--box' as string]: `${box}px` }}>
                <div className="cb-guide" style={{ left: 0, width: xs[2] + box }} />
                {xs.map((x, i) => (
                  <div key={i} className={`cb-frame cb-frame--${i}`} style={{ left: x, width: box, height: Math.round(box * 1.24) }} />
                ))}
                {[0, 1].map((i) => (
                  <div key={i} className="cb-gap" style={{ left: xs[i] + box, width: gap, top: Math.round(box * 0.62) + 24 }}>
                    <span>{gap * 2}</span>
                  </div>
                ))}
              </div>
            )}
          </Stage>
        </div>
      }
    >
      Edges, centres and equal spacing as you drag.
    </Tile>
  );
}

export function Bento() {
  return (
    <div className="cb-grid">
      <Layers />
      <Local />
      <Paste />
      <Color />
      <Snap />
    </div>
  );
}
