import { useEffect, useRef, useState } from 'react';
import { ArrowRight, ArrowUp } from 'lucide-react';
import './footer.css';

// A dark slab that rises under the page: pitch, links, shortcuts, and where your files live.

export function Footer({ onOpen, onFeatures, onTop }: { onOpen: () => void; onFeatures: () => void; onTop: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [seen, setSeen] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setSeen(true);
          io.disconnect();
        }
      },
      { threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <footer ref={ref} className="lf" data-seen={seen || undefined}>
      <div className="lf-inner">
        <div className="lf-top">
          <div className="lf-pitch">
            <p className="lf-line">
              Collect everything.
              <br />
              <span>Keep it yours.</span>
            </p>
            <button className="lf-cta" onClick={onOpen}>
              Open Crunch <ArrowRight size={16} />
            </button>
          </div>

          <nav className="lf-cols" aria-label="Footer">
            <div className="lf-col">
              <span className="lf-head">Product</span>
              <button onClick={onFeatures}>Features</button>
              <button onClick={onOpen}>Open the canvas</button>
              <button onClick={onTop}>Back to top</button>
            </div>
            <div className="lf-col">
              <span className="lf-head">Shortcuts</span>
              <span className="lf-key">
                <kbd>⌘</kbd>
                <kbd>V</kbd> Paste
              </span>
              <span className="lf-key">
                <kbd>⌘</kbd>
                <kbd>G</kbd> Group
              </span>
              <span className="lf-key">
                <kbd>⌘</kbd>
                <kbd>Z</kbd> Undo
              </span>
            </div>
            <div className="lf-col">
              <span className="lf-head">Your library</span>
              <span className="lf-text">No account, no cloud.</span>
              <span className="lf-text">Works offline.</span>
            </div>
          </nav>
        </div>
      </div>

      <div className="lf-inner">
        <div className="lf-bottom">
          <span>© {new Date().getFullYear()} Crunch</span>
          <span className="lf-dot">A local-first inspiration canvas.</span>
          <button className="lf-up" onClick={onTop} aria-label="Back to top">
            <ArrowUp size={15} />
          </button>
        </div>
      </div>
    </footer>
  );
}
