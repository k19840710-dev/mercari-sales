import React from 'react';

// Tailwindのカラー名 → 実際の色（SVGのstroke/fillはクラス名を解釈できないため）。
// CATEGORIESで使っている色名だけカバーしていれば十分。
const HEX_MAP = {
  amber: '#f59e0b',
  lime: '#84cc16',
  indigo: '#6366f1',
  rose: '#f43f5e',
  orange: '#f97316',
  pink: '#ec4899',
  emerald: '#10b981',
  sky: '#0ea5e9',
  violet: '#8b5cf6',
  gray: '#6b7280',
  cyan: '#06b6d4',
  teal: '#14b8a6',
};

export function colorNameToHex(name) {
  return HEX_MAP[name] || '#64748b';
}

/**
 * ライブラリを使わない自前SVGのドーナツグラフ（TrendChart.jsxと同じ方針）。
 * props.slices: [{ id, label, value, colorName }]
 * props.centerLabel / props.centerValue: 中央に表示するラベルと値
 */
export default function DonutChart({ slices, centerLabel, centerValue }) {
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  const size = 160;
  const strokeWidth = 22;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  let offset = 0;
  const visibleSlices = slices.filter((s) => s.value > 0);
  const segments = total > 0 ? visibleSlices.map((s) => {
    const fraction = s.value / total;
    const dash = fraction * circumference;
    const seg = { ...s, dash, gap: circumference - dash, offset };
    offset += dash;
    return seg;
  }) : [];

  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <div className="relative shrink-0" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="#334155" strokeWidth={strokeWidth} />
          {segments.map((seg) => (
            <circle
              key={seg.id}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={colorNameToHex(seg.colorName)}
              strokeWidth={strokeWidth}
              strokeDasharray={`${seg.dash} ${seg.gap}`}
              strokeDashoffset={-seg.offset}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-2">
          <span className="text-[10px] text-slate-400">{centerLabel}</span>
          <span className="text-base font-bold text-white">{centerValue}</span>
        </div>
      </div>

      <div className="flex-1 w-full space-y-1.5 min-w-0">
        {visibleSlices.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-2">データがありません</p>
        ) : (
          visibleSlices.map((s) => (
            <div key={s.id} className="flex items-center justify-between text-sm gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: colorNameToHex(s.colorName) }} />
                <span className="text-slate-300 truncate">{s.label}</span>
              </div>
              <div className="text-right shrink-0">
                <span className="font-bold text-white">¥{s.value.toLocaleString()}</span>
                <span className="text-xs text-slate-400 ml-1.5">
                  ({total > 0 ? Math.round((s.value / total) * 100) : 0}%)
                </span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
