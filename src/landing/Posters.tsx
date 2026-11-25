// Graphic "inspiration" artwork for the demos: purely graphic compositions
// (shapes and colour), never drawn stand-ins for photographs.

export type PosterKind = 'sun' | 'arches' | 'grid' | 'bauhaus' | 'waves' | 'type';

export function Poster({ kind, className = '' }: { kind: PosterKind; className?: string }) {
  return (
    <div className={`lp-poster lp-poster--${kind} ${className}`} aria-hidden>
      {kind === 'sun' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#E8603C" />
          <circle cx="50" cy="52" r="30" fill="#1B1A17" />
          <rect x="0" y="92" width="100" height="4" fill="#F4D9B5" />
          <rect x="0" y="100" width="100" height="4" fill="#F4D9B5" opacity=".7" />
          <rect x="0" y="108" width="100" height="4" fill="#F4D9B5" opacity=".4" />
        </svg>
      )}
      {kind === 'arches' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#1F3D33" />
          {[0, 1, 2, 3].map((i) => (
            <path
              key={i}
              d={`M ${18 + i * 4} 124 V ${70 - i * 2} a ${32 - i * 4} ${32 - i * 4} 0 0 1 ${64 - i * 8} 0 V 124`}
              fill="none"
              stroke="#EFE6D2"
              strokeOpacity={1 - i * 0.2}
              strokeWidth="2.4"
            />
          ))}
          <circle cx="50" cy="26" r="6" fill="#E9B44C" />
        </svg>
      )}
      {kind === 'grid' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#F1EEE7" />
          {Array.from({ length: 6 }).map((_, r) =>
            Array.from({ length: 5 }).map((__, c) => (
              <circle key={`${r}-${c}`} cx={18 + c * 16} cy={22 + r * 16} r="2.6" fill="#2C4BD8" />
            )),
          )}
          <rect x="50" y="54" width="32" height="32" fill="#E5402F" />
        </svg>
      )}
      {kind === 'bauhaus' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#F3C9C2" />
          <path d="M 0 124 L 50 40 L 100 124 Z" fill="#F2B632" />
          <path d="M 20 40 a 30 30 0 0 1 60 0 Z" fill="#2546C9" />
          <circle cx="78" cy="96" r="10" fill="#1B1A17" />
        </svg>
      )}
      {kind === 'waves' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#C9D8F0" />
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <path
              key={i}
              d={`M -5 ${40 + i * 14} q 13 -10 26 0 t 26 0 t 26 0 t 26 0`}
              fill="none"
              stroke="#203C8F"
              strokeWidth="3"
              strokeOpacity={0.35 + i * 0.12}
            />
          ))}
        </svg>
      )}
      {kind === 'type' && (
        <svg viewBox="0 0 100 124" preserveAspectRatio="xMidYMid slice">
          <rect width="100" height="124" fill="#191919" />
          <text x="10" y="74" fill="#F5F2EA" fontSize="54" fontWeight="800" fontFamily="Plus Jakarta Sans Variable, sans-serif" letterSpacing="-3">
            Aa
          </text>
          <rect x="10" y="88" width="34" height="3" fill="#E8603C" />
        </svg>
      )}
    </div>
  );
}
