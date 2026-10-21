import React, { useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import type { Work, PosterWallSettings } from './shared';

function PosterColumn({ posters, rows, index, tileHeight, paused, speed }: {
  posters: string[]; rows: number; index: number; tileHeight: number; paused: boolean; speed: number;
}) {
  const track = useRef<HTMLDivElement>(null);
  const distance = useRef(0);
  const firstRow = useRef(0);
  const [base, setBase] = useState(0);
  const direction = index % 2 ? -1 : 1;
  useEffect(() => {
    if (paused || speed === 0) return;
    let frame = 0, previous = 0;
    const move = (now: number) => {
      // A returning/backgrounded window must not jump forward to catch up.
      const delta = previous ? Math.min(now - previous, 80) : 0;
      previous = now;
      distance.current += direction * tileHeight * delta / 14_000 * speed / 100;
      const nextBase = Math.floor(distance.current / tileHeight);
      if (firstRow.current !== nextBase) {
        firstRow.current = nextBase;
        // Commit the new offscreen row and its compensating transform in the
        // same frame. Absolute row keys keep every visible image node intact.
        flushSync(() => setBase(nextBase));
      }
      if (track.current) track.current.style.transform = `translate3d(0, ${-(distance.current - nextBase * tileHeight)}px, 0)`;
      frame = requestAnimationFrame(move);
    };
    frame = requestAnimationFrame(move);
    return () => cancelAnimationFrame(frame);
  }, [paused, tileHeight, direction, speed]);
  return <div className={`mosaic-column ${index % 2 ? 'mosaic-stagger' : ''}`}><div className="mosaic-track" ref={track}>
    {Array.from({ length: rows }, (_, row) => {
      const sequence = base + row;
      const name = posters[((sequence % posters.length) + posters.length) % posters.length];
      return <div className="mosaic-tile" key={sequence}><img src={`library://image/${name}`} alt="" decoding="async"
        onError={event => { event.currentTarget.style.visibility = 'hidden'; }} onLoad={event => { event.currentTarget.style.visibility = 'visible'; }}/></div>;
    })}
  </div></div>;
}

export default function PosterWall({ works, paused, settings }: { works: Work[]; paused: boolean; settings: PosterWallSettings }) {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  useEffect(() => { const resize = () => setSize({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  const posters = useMemo(() => works.filter(w => w.mediaType === 'movie' && w.poster).map(w => w.poster!), [works]);
  const columns = Math.max(2, Math.ceil(size.width / 220));
  const tileHeight = (size.width + 24 - 16 * (columns - 1)) / columns * 1.5 + 16;
  const rows = Math.ceil(size.height / tileHeight) + 5;
  return <div className="overview-wall" aria-hidden="true" style={{ '--mosaic-height': `${tileHeight}px`, '--mosaic-columns': columns, '--mosaic-blur': `${settings.overviewBlur}px`, '--mosaic-opacity': settings.overviewOpacity / 100, '--mosaic-saturation': settings.overviewSaturation / 100 } as React.CSSProperties}>
    <div className="mosaic-grid">{posters.length > 0 && Array.from({ length: columns }, (_, index) => {
      const column = posters.filter((_, i) => i % columns === index);
      return <PosterColumn key={`${tileHeight}-${index}-${posters.join('|')}`} posters={column.length ? column : [posters[index % posters.length]]} rows={rows} index={index} tileHeight={tileHeight} paused={paused || settings.overviewOpacity === 0} speed={settings.overviewSpeed}/>;
    })}</div><div className="mosaic-shade"/>
  </div>;
}
