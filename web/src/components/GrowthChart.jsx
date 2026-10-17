import React from 'react';

// Biểu đồ % tăng so với Ngày 0 của Like / Comment / Share theo từng ngày
const SERIES = [['likes', 'Like', '#2D6CDF'], ['comments', 'Comment', '#E08A00'], ['shares', 'Share', '#16A34A']];

export default function GrowthChart({ snaps }) {
  const rows = snaps.filter((s) => s.likes !== null || s.comments !== null || s.shares !== null);
  if (rows.length < 2) return <p className="muted small">Cần ít nhất 2 lần đọc số để vẽ biểu đồ.</p>;
  const base = {};
  for (const [k] of SERIES) base[k] = rows.find((r) => r[k] !== null)?.[k] ?? null;
  const pct = (v, b) => (v === null || b === null ? null : b === 0 ? (v > 0 ? 100 : 0) : ((v - b) * 100) / b);
  const pts = SERIES.map(([k]) => rows.map((r) => pct(r[k], base[k])));
  const all = pts.flat().filter((v) => v !== null);
  const max = Math.max(10, ...all), min = Math.min(0, ...all);
  const W = 460, H = 160, L = 40, B = 22, T = 8;
  const x = (i) => L + (i * (W - L - 10)) / (rows.length - 1);
  const y = (v) => T + ((max - v) * (H - T - B)) / (max - min || 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Biểu đồ tăng trưởng">
      {[min, 0, max / 2, max].filter((v, i, a) => a.indexOf(v) === i).map((v) => (
        <g key={v}><line x1={L} x2={W - 10} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end">{Math.round(v)}%</text></g>
      ))}
      <line x1={L} x2={W - 10} y1={y(10)} y2={y(10)} className="threshold" />
      {rows.map((r, i) => <text key={i} x={x(i)} y={H - 6} textAnchor="middle">N{r.day_index}</text>)}
      {SERIES.map(([k, , color], si) => {
        const d = pts[si].map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
        return d.length ? <polyline key={k} points={d.join(' ')} fill="none" stroke={color} strokeWidth="2" /> : null;
      })}
      <g transform={`translate(${L + 6}, ${T + 6})`}>
        {SERIES.map(([k, label, color], i) => <g key={k} transform={`translate(${i * 80}, 0)`}><rect width="10" height="3" y="4" fill={color} /><text x="14" y="9" textAnchor="start">{label}</text></g>)}
      </g>
    </svg>
  );
}
