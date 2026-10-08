/**
 * SVG rendering of figural item content (matrix cells, series panels). All
 * figures are drawn in a 0..100 coordinate box with the achromatic stimulus
 * palette, so no item depends on colour vision.
 */

import { useId } from "react";
import { LINE_ELEMENTS, markerPoint } from "@/lib/items/figures";
import type { EntityLayer, FigureSpec, ShapeKind } from "@/lib/items/types";

const INK = "var(--stim-ink)";
const PAPER = "var(--stim-paper)";
const STROKE = "var(--stim-stroke)";

const NORMAL_RADIUS = [8, 11.5, 15];
const LARGE_RADIUS = [14, 20.5, 27];

const LAYOUTS: Record<number, [number, number][]> = {
  1: [[50, 50]],
  2: [
    [30, 50],
    [70, 50],
  ],
  3: [
    [50, 29],
    [29, 69],
    [71, 69],
  ],
  4: [
    [31, 31],
    [69, 31],
    [31, 69],
    [69, 69],
  ],
};

function polygon(points: [number, number][]): string {
  return points.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
}

function regular(n: number, r: number, rotationDeg = -90): [number, number][] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rotationDeg + (360 / n) * i) * Math.PI) / 180;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
}

export function shapePoints(shape: ShapeKind, r: number): [number, number][] | null {
  switch (shape) {
    case "circle":
      return null;
    case "square": {
      const h = r * 0.82;
      return [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ];
    }
    case "triangle":
      return regular(3, r * 1.18).map(([x, y]) => [x, y + r * 0.18]);
    case "diamond":
      return [
        [0, -r * 1.15],
        [r * 0.85, 0],
        [0, r * 1.15],
        [-r * 0.85, 0],
      ];
    case "pentagon":
      return regular(5, r * 1.05).map(([x, y]) => [x, y + r * 0.05]);
    case "hexagon":
      return regular(6, r * 1.02, 0);
    case "star": {
      const outer = regular(5, r * 1.2);
      const inner = regular(5, r * 0.5, -54);
      return outer.flatMap((p, i) => [p, inner[i]]).map(([x, y]) => [x, y + r * 0.08]);
    }
    case "cross": {
      const a = r * 0.36;
      const b = r * 1.05;
      return [
        [-a, -b],
        [a, -b],
        [a, -a],
        [b, -a],
        [b, a],
        [a, a],
        [a, b],
        [-a, b],
        [-a, a],
        [-b, a],
        [-b, -a],
        [-a, -a],
      ];
    }
    case "arrow": {
      const w = r * 0.32;
      return [
        [0, -r * 1.2],
        [r * 0.82, -r * 0.18],
        [w, -r * 0.18],
        [w, r * 1.15],
        [-w, r * 1.15],
        [-w, -r * 0.18],
        [-r * 0.82, -r * 0.18],
      ];
    }
  }
}

function Shape({ entity, cx, cy, r, patternId }: { entity: EntityLayer; cx: number; cy: number; r: number; patternId: string }) {
  const fill = entity.fill === "solid" ? INK : entity.fill === "striped" ? `url(#${patternId})` : PAPER;
  const common = { fill, stroke: INK, strokeWidth: STROKE, strokeLinejoin: "round" as const };
  const pts = shapePoints(entity.shape, r);
  const rotate = entity.shape === "arrow" ? entity.orientation * 45 : 0;
  if (!pts) return <circle cx={cx} cy={cy} r={r} {...common} />;
  return <polygon points={polygon(pts)} transform={`translate(${cx} ${cy}) rotate(${rotate})`} {...common} />;
}

export function FigureLayers({ figure, patternId }: { figure: FigureSpec; patternId: string }) {
  return (
    <>
      {figure.layers.map((layer, li) => {
        if (layer.kind === "entity") {
          const positions = LAYOUTS[layer.count] ?? LAYOUTS[1];
          const radii = layer.large && layer.count === 1 ? LARGE_RADIUS : NORMAL_RADIUS;
          const r = radii[layer.size] ?? radii[1];
          return (
            <g key={li}>
              {positions.map(([x, y], i) => (
                <Shape key={i} entity={layer} cx={x} cy={y} r={r} patternId={patternId} />
              ))}
            </g>
          );
        }
        if (layer.kind === "lines") {
          return (
            <g key={li} fill="none" stroke={INK} strokeWidth={STROKE} strokeLinecap="round">
              {layer.elements.map((id) => {
                const el = LINE_ELEMENTS[id];
                return el.kind === "line" ? (
                  <line key={id} x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} />
                ) : (
                  <circle key={id} cx={el.cx} cy={el.cy} r={el.r} />
                );
              })}
            </g>
          );
        }
        const [x, y] = markerPoint(layer.position);
        return layer.shape === "dot" ? (
          <circle key={li} cx={x} cy={y} r={4.6} fill={INK} />
        ) : (
          <rect key={li} x={x - 4} y={y - 4} width={8} height={8} fill={INK} />
        );
      })}
    </>
  );
}

/** Diagonal hatching used for the "striped" fill. */
export function StripePattern({ id }: { id: string }) {
  return (
    <pattern id={id} patternUnits="userSpaceOnUse" width="4.5" height="4.5" patternTransform="rotate(45)">
      <rect width="4.5" height="4.5" fill={PAPER} />
      <line x1="0" y1="0" x2="0" y2="4.5" stroke={INK} strokeWidth="1.7" />
    </pattern>
  );
}

export function FigureSvg({
  figure,
  label,
  className,
}: {
  figure: FigureSpec | null;
  label?: string;
  className?: string;
}) {
  const uid = useId().replace(/[:«»]/g, "");
  const patternId = `stripe-${uid}`;
  return (
    <svg viewBox="0 0 100 100" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <StripePattern id={patternId} />
      </defs>
      {figure ? (
        <FigureLayers figure={figure} patternId={patternId} />
      ) : (
        <text x="50" y="50" textAnchor="middle" dominantBaseline="central" fontSize="34" fill="var(--stim-dark)" fontFamily="var(--font-geist-sans)">
          ?
        </text>
      )}
    </svg>
  );
}
