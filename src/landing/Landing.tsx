import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import { HeroDemo } from './HeroDemo';
import { Bento } from './Bento';
import { Footer } from './Footer';
import './landing.css';

/** Fades its children up the first time they scroll into view. */
function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
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
      { threshold: 0.15, rootMargin: '0px 0px -8% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lp-reveal ${className}`} data-seen={seen || undefined} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

/** A headline whose words rise in, one after another. */
function Words({ text, start = 0, step = 55 }: { text: string; start?: number; step?: number }) {
  return (
    <>
      {text.split(' ').map((w, i) => (
        <span key={i} className="lp-word" style={{ animationDelay: `${start + i * step}ms` }}>
          {w}
          {' '}
        </span>
      ))}
    </>
  );
}

export default function Landing({ onOpenApp, animateIn = false }: { onOpenApp: () => void; animateIn?: boolean }) {
  const scroller = useRef<HTMLDivElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const on = () => setScrolled(el.scrollTop > 12);
    el.addEventListener('scroll', on, { passive: true });
    return () => el.removeEventListener('scroll', on);
  }, []);

  // Leave with a short fade, then hand back to the app.
  const open = () => {
    if (leaving) return;
    setLeaving(true);
    window.setTimeout(onOpenApp, 260);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') open();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  const toFeatures = () => scroller.current?.querySelector('#features')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div ref={scroller} className="landing" data-tone="light" data-enter={animateIn || undefined} data-leaving={leaving || undefined}>
      <header className="lp-nav" data-scrolled={scrolled || undefined}>
        <div className="lp-nav-inner">
          <button className="lp-logo" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}>
            Crunch
          </button>
          <nav className="lp-links">
            <button onClick={toFeatures}>Features</button>
            <button className="lp-btn lp-btn--dark lp-btn--small" onClick={open}>
              Open Crunch
            </button>
          </nav>
        </div>
      </header>

      <main>
        <section className="lp-hero">
          <h1 className="lp-h1">
            <Words text="Every reference," start={140} />
            <br />
            <span className="lp-h1-soft">
              <Words text="one infinite canvas." start={360} />
            </span>
          </h1>
          <p className="lp-sub lp-in" style={{ animationDelay: '640ms' }}>
            Paste images from anywhere, arrange them like a design tool, and keep every file on your own machine.
          </p>
          <div className="lp-ctas lp-in" style={{ animationDelay: '760ms' }}>
            <button className="lp-btn lp-btn--dark" onClick={open}>
              Open Crunch <ArrowRight size={16} />
            </button>
            <button className="lp-btn lp-btn--ghost" onClick={toFeatures}>
              See what's inside
            </button>
          </div>

          <div className="lp-demo lp-rise" style={{ animationDelay: '880ms' }}>
            <HeroDemo />
          </div>
        </section>

        <section className="lp-features" id="features">
          <Reveal className="lp-section-head">
            <span className="lp-kicker">Built for collecting</span>
            <h2 className="lp-h2">
              Everything a moodboard needs.
              <br />
              <span>Nothing it doesn't.</span>
            </h2>
          </Reveal>
          <Reveal delay={80}>
            <Bento />
          </Reveal>
        </section>

        <section className="lp-cta">
          <Reveal className="lp-cta-inner">
            <h2 className="lp-h2 lp-h2--center">
              Your next board starts with{' '}
              <span className="lp-key-inline" aria-label="Command V">
                <kbd className="lp-cap">
                  <span>⌘</span>
                </kbd>
                <kbd className="lp-cap">
                  <span>V</span>
                </kbd>
              </span>
              <br />
              <span>Copy any image or link, then paste it onto the canvas.</span>
            </h2>
            <p className="lp-cta-note">
              Press <kbd>Esc</kbd> to jump straight in.
            </p>
          </Reveal>
        </section>
      </main>

      <Footer onOpen={open} onFeatures={toFeatures} onTop={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })} />
    </div>
  );
}
