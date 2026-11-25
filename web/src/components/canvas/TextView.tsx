// A text layer that sizes itself to its content.
import { memo, useEffect, useLayoutEffect, useRef } from 'react';
import { type Item } from '../../api';

export const PLAINTEXT_OK = (() => {
  const d = document.createElement('div');
  try {
    d.contentEditable = 'plaintext-only';
  } catch {
    return false;
  }
  return d.contentEditable === 'plaintext-only';
})();

/** A text item. Sizes itself to its content and reports that size back. */
export const TextView = memo(function TextView({
  item,
  editing,
  dark,
  onMeasure,
  onDone,
}: {
  item: Item;
  editing: boolean;
  dark: boolean;
  onMeasure: (id: string, w: number, h: number) => void;
  onDone: (id: string, text: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const measure = () => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (Math.abs(w - item.w) > 0.5 || Math.abs(h - item.h) > 0.5) onMeasure(item.id, w, h);
  };
  useLayoutEffect(measure);
  useEffect(() => {
    // Fonts can finish loading after first paint.
    document.fonts?.ready.then(measure);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!editing || !el) return;
    el.innerText = item.text ?? '';
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  return (
    <div
      className={`item text${editing ? ' editing' : ''}${item.locked ? ' locked' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
        fontSize: item.fontSize ?? 24,
        fontWeight: item.fontWeight ?? 500,
        opacity: item.opacity ?? 1,
        color: item.color ?? (dark ? '#EDEDEC' : '#191919'),
      }}
    >
      <div
        ref={ref}
        className="text-body"
        contentEditable={editing ? (PLAINTEXT_OK ? 'plaintext-only' : true) : false}
        onPaste={(e) => {
          if (PLAINTEXT_OK) return;
          // Keep pasted text plain where the browser can't enforce it.
          e.preventDefault();
          document.execCommand('insertText', false, e.clipboardData.getData('text/plain'));
        }}
        suppressContentEditableWarning
        spellCheck={editing}
        onInput={measure}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            // Leave editing but keep the text selected (Figma); don't let the canvas clear it.
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.blur();
          }
        }}
        onBlur={(e) => {
          if (!editing) return;
          const text = e.currentTarget.innerText;
          // Hand the DOM back to React before it re-renders the committed text.
          e.currentTarget.textContent = '';
          onDone(item.id, text);
        }}
      >
        {editing ? null : item.text}
      </div>
    </div>
  );
});
