import React from 'react';

const HEIGHT = 200;
const PAD_TOP = 20;
const PAD_BOTTOM = 28;
const PAD_LEFT = 64;
const PAD_RIGHT = 24;
const MIN_BAR_SLOT = 64;

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
 * ライブラリを使わない自前SVGの棒グラフ（TrendChart.jsxと同じ方針）。年別比較専用。
 * props.series: [{ key: '2026', xLabel: '2026', fullLabel: '2026年', value: 390000 }, ...]
 * props.highlightKey: 強調表示する年のkey（現在選択中の年）
 */
export default function YearlyBarChart({ series, highlightKey }) {
  if (!series.length) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        データがまだありません。利用明細を記録すると、ここに年別の比較が表示されます。
      </div>
    );
  }

  const width = Math.max(series.length * MIN_BAR_SLOT + PAD_LEFT + PAD_RIGHT, 280);
  const innerW = width - PAD_LEFT - PAD_RIGHT;
  const innerH = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxVal = Math.max(...series.map((p) => p.value));
  const niceMax = niceCeil(maxVal || 1);
  const baseline = PAD_TOP + innerH;
  const slotW = innerW / series.length;
  const barW = Math.min(slotW * 0.5, 40);

  const yAt = (v) => PAD_TOP + innerH - (v / niceMax) * innerH;
  const xCenterAt = (i) => PAD_LEFT + slotW * (i + 0.5);

  const highlighted = series.find((p) => p.key === highlightKey) || series[series.length - 1];

  return (
    <div>
      <div className="mb-3 flex items-baseline gap-2 px-1">
        <span className="text-2xl font-bold text-white tabular-nums">{formatYen(highlighted.value)}</span>
        <span className="text-sm text-slate-400">{highlighted.fullLabel}</span>
      </div>

      <div className="overflow-x-auto">
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block"
          role="img"
          aria-label={`${series[0].fullLabel}から${series[series.length - 1].fullLabel}までの年別支出比較。${highlighted.fullLabel}は${formatYen(highlighted.value)}。`}
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

          {series.map((p) => {
            const isActive = p.key === highlighted.key;
            const h = (p.value / niceMax) * innerH;
            return (
              <rect
                key={p.key}
                x={xCenterAt(series.indexOf(p)) - barW / 2}
                y={baseline - h}
                width={barW}
                height={h}
                rx={4}
                className={isActive ? 'fill-indigo-400' : 'fill-slate-600'}
              />
            );
          })}

          {series.map((p, i) => (
            <text key={p.key} x={xCenterAt(i)} y={HEIGHT - 8} textAnchor="middle" className="fill-slate-500 text-[10px]">
              {p.xLabel}
            </text>
          ))}
        </svg>
      </div>
    </div>
  );
}
