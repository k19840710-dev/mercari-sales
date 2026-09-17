import React, { useCallback, useEffect, useRef, useState } from 'react';

const HEIGHT = 200;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;
const PAD_LEFT = 64;
const PAD_RIGHT = 24;
const MIN_GAP = 50;

function niceCeil(value) {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const fraction = value / base;
  let niceFraction;
  if (fraction <= 1) niceFraction = 1;
  else if (fraction <= 2) niceFraction = 2;
  else if (fraction <= 5) niceFraction = 5;
  else niceFraction = 10;
  return niceFraction * base;
}

function formatYen(n) {
  return '¥' + Math.round(n || 0).toLocaleString('ja-JP');
}

/**
 * Hand-rolled SVG line chart — a single series (total spend, or one card's
 * spend) over a continuous run of months. No chart library dependency.
 *
 * props.series: [{ key: '2026-04', xLabel: '4月', fullLabel: '2026年4月', value: 85000 }, ...]
 */
export default function TrendChart({ series }) {
  const wrapRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(320);
  const [activeIndex, setActiveIndex] = useState(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    const update = () => setContainerWidth(el.clientWidth || 320);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setActiveIndex(null);
    const el = wrapRef.current;
    if (el) {
      requestAnimationFrame(() => { el.scrollLeft = el.scrollWidth; });
    }
  }, [series]);

  const lastIdx = series.length - 1;
  const neededWidth = PAD_LEFT + PAD_RIGHT + Math.max(series.length - 1, 0) * MIN_GAP
    + (series.length === 1 ? 60 : 0);
  const width = Math.max(containerWidth, neededWidth);
  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxVal = Math.max(...series.map((p) => p.value));
  const niceMax = niceCeil(maxVal || 1);
  const baseline = PAD_TOP + innerH;

  const xAt = (i) => PAD_LEFT + (series.length === 1 ? innerW / 2 : (innerW * i) / (series.length - 1));
  const yAt = (v) => PAD_TOP + innerH - (v / niceMax) * innerH;

  let lineD = '';
  series.forEach((p, i) => { lineD += `${i === 0 ? 'M' : 'L'}${xAt(i)},${yAt(p.value)} `; });
  const areaD = `${lineD}L${xAt(lastIdx)},${baseline} L${xAt(0)},${baseline} Z`;

  const labelStep = Math.max(1, Math.ceil(series.length / 12));
  const shownIndex = activeIndex ?? lastIdx;

  const handlePointer = useCallback((clientX, svgEl) => {
    const rect = svgEl.getBoundingClientRect();
    if (!rect.width) return;
    const scale = width / rect.width;
    const localX = (clientX - rect.left) * scale;
    let closest = 0;
    let closestDist = Infinity;
    series.forEach((p, i) => {
      const dist = Math.abs(xAt(i) - localX);
      if (dist < closestDist) { closestDist = dist; closest = i; }
    });
    setActiveIndex(closest);
  }, [series, width]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!series.length) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        データがまだありません。利用明細を記録すると、ここに月別の推移が表示されます。
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <span className="text-2xl font-bold text-white tabular-nums">
          {formatYen(series[shownIndex].value)}
        </span>
        <span className="text-sm text-slate-400">{series[shownIndex].fullLabel}</span>
      </div>

      <div ref={wrapRef} className="overflow-x-auto" onMouseLeave={() => setActiveIndex(null)}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block cursor-crosshair"
          onPointerMove={(e) => handlePointer(e.clientX, e.currentTarget)}
          onPointerDown={(e) => handlePointer(e.clientX, e.currentTarget)}
          role="img"
          aria-label={`${series[0].fullLabel}から${series[lastIdx].fullLabel}までの支払額推移。直近は${formatYen(series[lastIdx].value)}。`}
        >
          {[0, 0.5, 1].map((frac) => {
            const y = yAt(niceMax * frac);
            return (
              <g key={frac}>
                <line x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={y} y2={y} stroke="currentColor" strokeWidth="1" className="text-slate-700" />
                <text x={PAD_LEFT - 10} y={y + 3} textAnchor="end" className="fill-slate-500 text-[10px] tabular-nums">
                  {formatYen(niceMax * frac)}
                </text>
              </g>
            );
          })}

          <path d={areaD} className="fill-indigo-500" opacity="0.14" />
          <path d={lineD.trim()} fill="none" className="stroke-indigo-400" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

          {activeIndex !== null && (
            <line
              x1={xAt(activeIndex)} x2={xAt(activeIndex)} y1={PAD_TOP} y2={baseline}
              stroke="currentColor" strokeWidth="1" strokeDasharray="2 3" className="text-slate-500"
            />
          )}

          {series.map((p, i) => {
            if (!(i === 0 || i === lastIdx || i % labelStep === 0)) return null;
            return (
              <text key={p.key} x={xAt(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
                {p.xLabel}
              </text>
            );
          })}

          {series.map((p, i) => (
            <circle
              key={p.key}
              cx={xAt(i)}
              cy={yAt(p.value)}
              r={i === lastIdx ? 5 : i === activeIndex ? 4.5 : 3}
              className={i === activeIndex || i === lastIdx ? 'fill-indigo-300' : 'fill-indigo-400'}
              stroke="#0f172a"
              strokeWidth="2"
            />
          ))}
        </svg>
      </div>
    </div>
  );
}
