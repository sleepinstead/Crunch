import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEscapeLayer, useFocusTrap } from './ui';
import { Poster } from './Posters';
import './onboarding.css';

/** localStorage key: set once the tour has been finished or dismissed. */
export const ONBOARDED_KEY = 'crunch.onboarded';

const MOD = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘' : 'Ctrl';

type Step = { kicker: string; title: string; text: ReactNode; art: ReactNode; tone: string };

/* ---------- the little scenes (CSS loops, one per step) ---------- */

function Board({ children, tone }: { children: ReactNode; tone?: string }) {
  return (
    <div className="ob-board" data-tone={tone}>
      {children}
    </div>
  );
}

const WelcomeArt = () => (
  <Board>
    {(['sun', 'arches', 'bauhaus', 'grid'] as const).map((k, i) => (
      <div key={k} className={`ob-pop ob-pop--${i}`}>
        <Poster kind={k} />
      </div>
    ))}
    <span className="ob-spark ob-spark--a" />
    <span className="ob-spark ob-spark--b" />
    <span className="ob-spark ob-spark--c" />
  </Board>
);

const PasteArt = () => (
  <Board>
    <div className="ob-keys" aria-hidden>
      <kbd>{MOD}</kbd>
      <kbd>V</kbd>
    </div>
    <div className="ob-paste">
      <div className="ob-shimmer" />
      <Poster kind="bauhaus" />
      <div className="ob-sel">
        <i data-c="nw" />
        <i data-c="ne" />
        <i data-c="sw" />
        <i data-c="se" />
      </div>
    </div>
  </Board>
);

const ArrangeArt = () => (
  <Board>
    <div className="ob-row">
      <div className="ob-tile">
        <Poster kind="sun" />
      </div>
      <div className="ob-tile">
        <Poster kind="arches" />
      </div>
      <div className="ob-tile ob-tile--drag">
        <Poster kind="waves" />
      </div>
    </div>
    <div className="ob-guide" />
    <div className="ob-gap ob-gap--a">
      <span>24</span>
    </div>
    <div className="ob-gap ob-gap--b">
      <span>24</span>
    </div>
  </Board>
);

const GroupArt = () => (
  <Board>
    <div className="ob-trio">
      {(['grid', 'type', 'sun'] as const).map((k, i) => (
        <div key={k} className={`ob-pick ob-pick--${i}`}>
          <Poster kind={k} />
        </div>
      ))}
      <div className="ob-frame">
        <span>Group</span>
      </div>
    </div>
    <div className="ob-keys ob-keys--group" aria-hidden>
      <kbd>{MOD}</kbd>
      <kbd>G</kbd>
    </div>
  </Board>
);

const StyleArt = () => (
  <Board tone="style">
    <div className="ob-style-card">
      <div className="ob-tile ob-tile--still">
        <Poster kind="arches" />
      </div>
    </div>
    <div className="ob-swatch-bar" aria-hidden>
      <i style={{ background: '#F7F7F5' }} />
      <i style={{ background: '#F6EDE3' }} />
      <i style={{ background: '#E8EEF6' }} />
      <i style={{ background: '#1D1D1C' }} />
      <b className="ob-swatch-ring" />
    </div>
  </Board>
);

const STEPS: Step[] = [
  {
    kicker: 'Welcome',
    title: 'A home for every reference',
    text: 'Crunch is an infinite canvas for collecting images. Everything stays on your computer.',
    art: <WelcomeArt />,
    tone: 'orange',
  },
  {
    kicker: 'Collect',
    title: 'Paste anything',
    text: (
      <>
        Copy an image or a link and press <b>{MOD}V</b>. You can also drop files anywhere. Crunch saves the full file.
      </>
    ),
    art: <PasteArt />,
    tone: 'blue',
  },
  {
    kicker: 'Arrange',
    title: 'Drag, and it snaps',
    text: 'Edges, centres and even spacing light up as you move things, so boards line up without trying.',
    art: <ArrangeArt />,
    tone: 'pink',
  },
  {
    kicker: 'Organise',
    title: 'Group what belongs together',
    text: (
      <>
        Select a few and press <b>{MOD}G</b>. Rename, lock or hide them from Layers in the sidebar.
      </>
    ),
    art: <GroupArt />,
    tone: 'green',
  },
  {
    kicker: 'Make it yours',
    title: 'Set the mood of each board',
    text: 'Pick a background colour and a pattern for every project. Each tab in the dock is its own board.',
    art: <StyleArt />,
    tone: 'violet',
  },
];

/* ---------- the tour ---------- */

export function Onboarding({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const [leaving, setLeaving] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const last = i === STEPS.length - 1;
  const step = STEPS[i];

  const close = () => {
    if (leaving) return;
    setLeaving(true);
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
    } catch {
      /* ignore */
    }
    closeTimer.current = window.setTimeout(onClose, 200);
  };
  const go = (n: number) => {
    if (n < 0 || n >= STEPS.length) return;
    setDir(n > i ? 1 : -1);
    setI(n);
  };

  useFocusTrap(card);
  useEscapeLayer(() => close());
  const closeTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      // Arrows page through the tour; Enter and Space stay with whichever button has focus.
      const onButton = (e.target as HTMLElement | null)?.closest('button');
      if (e.key === 'ArrowRight' || (e.key === 'Enter' && !onButton)) {
        e.preventDefault();
        if (last) close();
        else go(i + 1);
      } else if (e.key === 'ArrowLeft') {
        go(i - 1);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  return (
    <div className="scrim ob-scrim" data-leaving={leaving || undefined} onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div
        ref={card}
        className="ob"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ob-title"
        tabIndex={-1}
        data-tone={step.tone}
      >
        <button className="ob-close icon-btn" onClick={close} aria-label="Close tour">
          <X size={16} />
        </button>

        <div className="ob-art" aria-hidden>
          {/* keyed so each scene restarts its loop when it comes in */}
          <div key={i} className="ob-scene" data-dir={dir}>
            {step.art}
          </div>
        </div>

        <div className="ob-body">
          <div className="ob-progress" aria-hidden>
            {STEPS.map((_, n) => (
              <button key={n} className="ob-seg" data-on={n <= i || undefined} tabIndex={-1} onClick={() => go(n)} />
            ))}
          </div>
          <div key={i} className="ob-copy" data-dir={dir} aria-live="polite">
            <span className="ob-kicker">
              {step.kicker}
              <span className="ob-count">
                {i + 1} of {STEPS.length}
              </span>
            </span>
            <h2 id="ob-title" className="ob-title">
              {step.title}
            </h2>
            <p className="ob-text">{step.text}</p>
          </div>
        </div>

        <footer className="ob-foot">
          {i === 0 ? (
            <button className="ob-btn ob-btn--ghost" onClick={close}>
              Skip
            </button>
          ) : (
            <button className="ob-btn ob-btn--outline" onClick={() => go(i - 1)}>
              <ChevronLeft size={15} /> Previous
            </button>
          )}
          {last ? (
            <button className="ob-btn ob-btn--primary" onClick={close}>
              Start collecting <ArrowRight size={15} />
            </button>
          ) : (
            <button className="ob-btn ob-btn--primary" onClick={() => go(i + 1)}>
              Next <ChevronRight size={15} />
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
