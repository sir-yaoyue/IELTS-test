// 轻量 SVG 图表工具（无外部依赖，离线可用）。
// 只暴露数据→SVG 的纯函数与几个 React 组件，坐标系统一：像素。

export interface Pt {
  x: number;
  y: number;
  label?: string;
}

export interface Series {
  name: string;
  color: string;
  points: Pt[];
  /** 折线 / 面积 */
  kind?: 'line' | 'area' | 'scatter';
  /** 面积填充透明度 */
  fillOpacity?: number;
  dash?: string;
}

export interface ChartOpts {
  width: number;
  height: number;
  pad?: { top: number; right: number; bottom: number; left: number };
  xMin?: number;
  xMax?: number;
  yMin?: number;
  yMax?: number;
  xTicks?: number[];
  yTicks?: number[];
  xFormat?: (v: number) => string;
  yFormat?: (v: number) => string;
  xLabel?: string;
  yLabel?: string;
  /** 水平参考线 */
  refs?: { y: number; color?: string; label?: string; dash?: string }[];
}

function extent(nums: number[], lo?: number, hi?: number): [number, number] {
  let min = lo ?? Math.min(...nums);
  let max = hi ?? Math.max(...nums);
  if (!isFinite(min)) min = 0;
  if (!isFinite(max)) max = 1;
  if (min === max) {
    min -= 1;
    max += 1;
  }
  return [min, max];
}

export function buildScales(o: ChartOpts, allX: number[], allY: number[]) {
  const pad = o.pad ?? { top: 12, right: 14, bottom: 26, left: 40 };
  const [xMin, xMax] = extent(allX, o.xMin, o.xMax);
  const [yMin, yMax] = extent(allY, o.yMin, o.yMax);
  const iw = o.width - pad.left - pad.right;
  const ih = o.height - pad.top - pad.bottom;
  const sx = (x: number) => pad.left + ((x - xMin) / (xMax - xMin)) * iw;
  const sy = (y: number) => pad.top + ih - ((y - yMin) / (yMax - yMin)) * ih;
  return { pad, xMin, xMax, yMin, yMax, iw, ih, sx, sy };
}

function ticks(min: number, max: number, count = 4): number[] {
  if (count <= 0) return [];
  const step = (max - min) / (count - 1);
  const out: number[] = [];
  for (let i = 0; i < count; i++) out.push(+(min + step * i).toFixed(4));
  return out;
}

/** 折线/面积/散点图（多系列） */
export function LineChart({ series, opts }: { series: Series[]; opts: ChartOpts }) {
  const pad = opts.pad ?? { top: 12, right: 14, bottom: 26, left: 40 };
  const allX = series.flatMap((s) => s.points.map((p) => p.x));
  const allY = series.flatMap((s) => s.points.map((p) => p.y));
  const { sx, sy, xMin, xMax, yMin, yMax } = buildScales(opts, allX, allY);
  const xT = opts.xTicks ?? ticks(xMin, xMax, 5);
  const yT = opts.yTicks ?? ticks(yMin, yMax, 4);
  const xf = opts.xFormat ?? ((v: number) => String(Math.round(v)));
  const yf = opts.yFormat ?? ((v: number) => String(Math.round(v)));
  const bottomY = opts.height - pad.bottom;
  const topY = pad.top;

  return (
    <svg viewBox={`0 0 ${opts.width} ${opts.height}`} width="100%" style={{ maxWidth: opts.width, display: 'block', fontFamily: 'inherit' }}>
      {/* 网格 + Y 轴刻度 */}
      {yT.map((t, i) => (
        <g key={`y${i}`}>
          <line x1={pad.left} x2={opts.width - pad.right} y1={sy(t)} y2={sy(t)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={pad.left - 6} y={sy(t) + 3} textAnchor="end" fontSize={10} fill="#94a3b8">
            {yf(t)}
          </text>
        </g>
      ))}
      {/* X 轴刻度 */}
      {xT.map((t, i) => (
        <g key={`x${i}`}>
          <line x1={sx(t)} x2={sx(t)} y1={topY} y2={bottomY} stroke="#f1f5f9" strokeWidth={1} />
          <text x={sx(t)} y={bottomY + 14} textAnchor="middle" fontSize={10} fill="#94a3b8">
            {xf(t)}
          </text>
        </g>
      ))}
      {/* 轴框 */}
      <line x1={pad.left} x2={opts.width - pad.right} y1={bottomY} y2={bottomY} stroke="#cbd5e1" strokeWidth={1} />
      <line x1={pad.left} x2={pad.left} y1={topY} y2={bottomY} stroke="#cbd5e1" strokeWidth={1} />
      {/* 参考线 */}
      {opts.refs?.map((r, i) => (
        <g key={`ref${i}`}>
          <line x1={pad.left} x2={opts.width - pad.right} y1={sy(r.y)} y2={sy(r.y)} stroke={r.color ?? '#94a3b8'} strokeWidth={1} strokeDasharray={r.dash ?? '4 3'} />
          {r.label && (
            <text x={opts.width - pad.right - 2} y={sy(r.y) - 3} textAnchor="end" fontSize={9} fill={r.color ?? '#64748b'}>
              {r.label}
            </text>
          )}
        </g>
      ))}
      {/* 系列 */}
      {series.map((s, si) => {
        const kind = s.kind ?? 'line';
        if (kind === 'area') {
          const line = s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
          const base = sy(yMin);
          const areaPts = `${pad.left},${base} ${line} ${sx(s.points[s.points.length - 1]?.x ?? xMax)},${base}`;
          return (
            <g key={si}>
              <polygon points={areaPts} fill={s.color} fillOpacity={s.fillOpacity ?? 0.15} stroke="none" />
              <polyline points={line} fill="none" stroke={s.color} strokeWidth={2} />
            </g>
          );
        }
        if (kind === 'scatter') {
          return (
            <g key={si}>
              {s.points.map((p, pi) => (
                <circle key={pi} cx={sx(p.x)} cy={sy(p.y)} r={2.6} fill={s.color} opacity={0.75}>
                  {p.label && <title>{p.label}</title>}
                </circle>
              ))}
            </g>
          );
        }
        const line = s.points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(' ');
        return (
          <g key={si}>
            <polyline points={line} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dash} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, pi) => (
              <circle key={pi} cx={sx(p.x)} cy={sy(p.y)} r={1.8} fill={s.color}>
                {p.label && <title>{p.label}</title>}
              </circle>
            ))}
          </g>
        );
      })}
      {/* 轴标签 */}
      {opts.xLabel && (
        <text x={(pad.left + opts.width - pad.right) / 2} y={opts.height - 2} textAnchor="middle" fontSize={10} fill="#64748b">
          {opts.xLabel}
        </text>
      )}
      {opts.yLabel && (
        <text x={10} y={(topY + bottomY) / 2} textAnchor="middle" fontSize={10} fill="#64748b" transform={`rotate(-90 10 ${(topY + bottomY) / 2})`}>
          {opts.yLabel}
        </text>
      )}
    </svg>
  );
}

/** 横向条形（分类 → 数值） */
export function HBarChart({ items, opts }: { items: { label: string; value: number; color?: string }[]; opts: { width?: number; height?: number } }) {
  const width = opts?.width ?? 360;
  const rowH = 26;
  const pad = { top: 4, right: 40, bottom: 4, left: 96 };
  const height = opts?.height ?? Math.max(items.length * rowH + pad.top + pad.bottom, 60);
  const max = Math.max(1, ...items.map((i) => i.value));
  const iw = width - pad.left - pad.right;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" style={{ maxWidth: width, display: 'block', fontFamily: 'inherit' }}>
      {items.map((it, i) => {
        const y = pad.top + i * rowH + rowH / 2;
        const w = (it.value / max) * iw;
        return (
          <g key={i}>
            <text x={pad.left - 8} y={y + 3.5} textAnchor="end" fontSize={11} fill="#475569">
              {it.label}
            </text>
            <rect x={pad.left} y={y - 7} width={Math.max(w, it.value > 0 ? 2 : 0)} height={14} rx={3} fill={it.color ?? '#0f172a'} opacity={0.85} />
            <text x={pad.left + Math.max(w, 2) + 5} y={y + 3.5} fontSize={11} fill="#64748b">
              {it.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** 图例 */
export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
      {items.map((it) => (
        <span key={it.name} className="inline-flex items-center gap-1.5 text-xs text-slate-500">
          <span className="inline-block w-3 h-1.5 rounded-full" style={{ backgroundColor: it.color }} />
          {it.name}
        </span>
      ))}
    </div>
  );
}
