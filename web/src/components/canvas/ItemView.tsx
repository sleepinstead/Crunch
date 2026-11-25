// An image layer.
import { memo, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { type Item } from '../../api';

export const ItemView = memo(function ItemView({ item, small }: { item: Item; small: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <div
      className={`item${item.locked ? ' locked' : ''}`}
      data-item-id={item.id}
      style={{
        transform: `translate(${item.x}px, ${item.y}px)${item.rotation ? ` rotate(${item.rotation}deg)` : ''}`,
        width: item.w,
        height: item.h,
        opacity: item.opacity ?? 1,
      }}
    >
      {broken ? (
        <div className="item-broken" title="The browser can’t display this file. It is still saved in your library.">
          <ImageOff />
          <span>Can’t display this image</span>
        </div>
      ) : (
        // Drawn small: the preview is enough, and far cheaper to decode and keep in memory.
        <img src={small && item.thumb ? item.thumb : item.src} alt="" draggable={false} decoding="async" onError={() => setBroken(true)} />
      )}
    </div>
  );
});
