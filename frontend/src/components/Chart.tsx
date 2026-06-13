import { useState, useRef } from "react";
import { fmtUsd } from "../lib/api";

export interface ChartDataPoint {
  label: string;
  value: number;
  hoverLabel?: string;
}

interface ChartProps {
  data: ChartDataPoint[];
  isCurrency?: boolean;
}

export const Chart: React.FC<ChartProps> = ({ data, isCurrency = false }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  const rawMax = Math.max(0, ...data.map((d) => d.value));
  const max = rawMax === 0 ? 4 : rawMax;

  const W = 600;
  const H = 100; // Even shorter height to match small UI design style
  const leftPad = 44;
  const rightPad = 15;
  const topPad = 12;
  const bottomPad = 18;
  const plotW = W - leftPad - rightPad;
  const plotH = H - topPad - bottomPad;

  // Generate path points
  const points = data.map((d, i) => {
    const x = leftPad + (i / (data.length - 1)) * plotW;
    const y = topPad + plotH - (d.value / max) * plotH;
    return { x, y, val: d.value, label: d.label, hoverLabel: d.hoverLabel };
  });

  const linePath = points.length > 0
    ? points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ")
    : "";

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x.toFixed(1)} ${(topPad + plotH).toFixed(1)} L ${points[0].x.toFixed(1)} ${(topPad + plotH).toFixed(1)} Z`
    : "";

  const gridTicks = [0, 0.25, 0.5, 0.75, 1];

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!containerRef.current || points.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const svgX = (mouseX / rect.width) * W;
    const pct = (svgX - leftPad) / plotW;
    const idx = Math.min(points.length - 1, Math.max(0, Math.round(pct * (points.length - 1))));
    setHoveredIdx(idx);
  };

  const handleMouseLeave = () => {
    setHoveredIdx(null);
  };

  const activePoint = hoveredIdx !== null ? points[hoveredIdx] : null;

  return (
    <div className="ui-chart-wrap" ref={containerRef}>
      <div className="chart-svg-container">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="ui-chart"
          role="img"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          <defs>
            <linearGradient id="chart-grad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--brand)" stopOpacity="0.14" />
              <stop offset="100%" stopColor="var(--brand)" stopOpacity="0.00" />
            </linearGradient>
          </defs>

          {/* Grid lines */}
          {gridTicks.map((tick, idx) => {
            const y = topPad + plotH - tick * plotH;
            const val = tick * max;
            return (
              <g key={idx}>
                <line
                  x1={leftPad}
                  y1={y}
                  x2={W - rightPad}
                  y2={y}
                  stroke="var(--line-strong)"
                  strokeDasharray="4 4"
                  strokeWidth="0.8"
                />
                <text
                  x={leftPad - 6}
                  y={y + 3}
                  textAnchor="end"
                  fontSize="8.5"
                  fill="var(--ink-faint)"
                  fontWeight="500"
                  fontFamily="var(--font-sans)"
                >
                  {isCurrency ? fmtUsd(val) : Math.round(val)}
                </text>
              </g>
            );
          })}

          {/* Area path */}
          {areaPath && <path d={areaPath} fill="url(#chart-grad)" />}

          {/* Line path */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--brand)"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Hover indicator line & dot */}
          {activePoint && (
            <>
              <line
                x1={activePoint.x}
                y1={topPad}
                x2={activePoint.x}
                y2={topPad + plotH}
                stroke="var(--brand)"
                strokeWidth="1"
                strokeDasharray="3 3"
                opacity="0.6"
              />
              <circle
                cx={activePoint.x}
                cy={activePoint.y}
                r="3"
                fill="var(--brand)"
                stroke="var(--surface)"
                strokeWidth="1.5"
              />
            </>
          )}
        </svg>

        {/* Premium floating HTML tooltip */}
        {activePoint && (
          <div
            className="chart-tooltip"
            style={{
              left: `${(activePoint.x / W) * 100}%`,
              top: `${(activePoint.y / H) * 100}%`,
            }}
          >
            <div className="tooltip-date">{activePoint.label}</div>
            <div className="tooltip-value">
              {isCurrency ? fmtUsd(activePoint.val) : activePoint.val}
            </div>
            {activePoint.hoverLabel && (
              <div className="tooltip-sub">{activePoint.hoverLabel}</div>
            )}
          </div>
        )}
      </div>

      <div className="chart-x" style={{ paddingLeft: leftPad, paddingRight: rightPad }}>
        <span>{data[0]?.label}</span>
        <span>{data[data.length - 1]?.label}</span>
      </div>

      <style>{`
        .ui-chart-wrap { width: 100%; display: flex; flex-direction: column; position: relative; }
        .chart-svg-container { position: relative; width: 100%; }
        .ui-chart { width: 100%; height: auto; display: block; overflow: visible; }
        .chart-x { display: flex; justify-content: space-between; font-size: .68rem; color: var(--ink-faint); margin-top: 4px; }
        
        /* Floating Tooltip styling */
        .chart-tooltip {
          position: absolute;
          transform: translate(-50%, calc(-100% - 10px));
          background: rgba(15, 23, 42, 0.95);
          backdrop-filter: blur(8px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          color: #fff;
          padding: 6px 10px;
          border-radius: 5px;
          font-size: .72rem;
          font-family: var(--font-sans);
          box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
          pointer-events: none;
          z-index: 200;
          display: flex;
          flex-direction: column;
          gap: 1px;
          min-width: 110px;
          transition: left 0.06s ease-out, top 0.06s ease-out;
        }
        .tooltip-date {
          font-size: .62rem;
          color: rgba(255, 255, 255, 0.6);
          font-weight: 500;
        }
        .tooltip-value {
          font-size: .85rem;
          font-weight: 700;
          color: var(--brand, #3b82f6);
        }
        .tooltip-sub {
          font-size: .62rem;
          color: rgba(255, 255, 255, 0.5);
        }
      `}</style>
    </div>
  );
};
