/** SVG renderers for spatial items: polyominoes, isometric polycubes, paper folding. */

import { useId } from "react";
import { isometricFaces, normalize3 } from "@/lib/items/geometry";
import { foldSequence, regionPolygon, SHEET, type Pt } from "@/lib/items/paper";
import type { Cell2, FoldKind, Voxel } from "@/lib/items/types";

const INK = "var(--stim-ink)";
const PAPER = "var(--stim-paper)";

export function PolyominoSvg({ cells, rotationDeg = 0, label, className }: { cells: Cell2[]; rotationDeg?: number; label?: string; className?: string }) {
  const w = Math.max(...cells.map((c) => c[0])) + 1;
  const h = Math.max(...cells.map((c) => c[1])) + 1;
  // Size so the shape fits whatever its rotation (worst case is the diagonal).
  const span = Math.sqrt(w * w + h * h);
  const unit = 84 / span;
  const ox = 50 - (w * unit) / 2;
  const oy = 50 - (h * unit) / 2;
  return (
    <svg viewBox="0 0 100 100" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <g transform={`rotate(${rotationDeg} 50 50)`}>
        {cells.map(([x, y]) => (
          <rect
            key={`${x},${y}`}
            x={ox + x * unit}
            y={oy + y * unit}
            width={unit}
            height={unit}
            fill="var(--stim-mid)"
            stroke={INK}
            strokeWidth="var(--stim-stroke)"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

const SHADE = { top: "var(--stim-light)", right: "var(--stim-mid)", left: "var(--stim-dark)" } as const;

export function PolycubeSvg({ voxels, label, className }: { voxels: Voxel[]; label?: string; className?: string }) {
  const faces = isometricFaces(normalize3(voxels));
  const xs = faces.flatMap((f) => f.points.map((p) => p[0]));
  const ys = faces.flatMap((f) => f.points.map((p) => p[1]));
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = 88 / Math.max(maxX - minX, maxY - minY);
  const tx = (x: number) => 50 + (x - (minX + maxX) / 2) * scale;
  const ty = (y: number) => 50 + (y - (minY + maxY) / 2) * scale;
  return (
    <svg viewBox="0 0 100 100" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {faces.map((f, i) => (
        <polygon
          key={i}
          points={f.points.map(([x, y]) => `${tx(x).toFixed(2)},${ty(y).toFixed(2)}`).join(" ")}
          fill={SHADE[f.shade]}
          stroke={INK}
          strokeWidth={1.1}
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Paper folding
// ---------------------------------------------------------------------------

const PAD = 12;
const SCALE = (100 - 2 * PAD) / SHEET;
const sx = (v: number) => PAD + v * SCALE;
const pts = (poly: Pt[]) => poly.map(([x, y]) => `${sx(x)},${sx(y)}`).join(" ");

/** The half of `before` that moves during the fold. */
function movingFlap(before: ReturnType<typeof foldSequence>[number]["before"], kind: FoldKind): Pt[] {
  const { x0, x1, y0, y1 } = before;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  switch (kind) {
    case "left-over-right":
      return [[x0, y0], [mx, y0], [mx, y1], [x0, y1]];
    case "right-over-left":
      return [[mx, y0], [x1, y0], [x1, y1], [mx, y1]];
    case "top-over-bottom":
      return [[x0, y0], [x1, y0], [x1, my], [x0, my]];
    case "bottom-over-top":
      return [[x0, my], [x1, my], [x1, y1], [x0, y1]];
    case "diag-main":
      return [[x0, y0], [x1, y1], [x0, y1]];
    case "diag-anti":
      return [[x1, y0], [x1, y1], [x0, y1]];
  }
}

function foldArrow(before: ReturnType<typeof foldSequence>[number]["before"], kind: FoldKind): string {
  const { x0, x1, y0, y1 } = before;
  const mx = (x0 + x1) / 2;
  const my = (y0 + y1) / 2;
  const q = (a: number, b: number) => a + (b - a) / 4;
  let from: Pt;
  let to: Pt;
  switch (kind) {
    case "left-over-right":
      from = [q(x0, mx), my];
      to = [q(x1, mx), my];
      break;
    case "right-over-left":
      from = [q(x1, mx), my];
      to = [q(x0, mx), my];
      break;
    case "top-over-bottom":
      from = [mx, q(y0, my)];
      to = [mx, q(y1, my)];
      break;
    case "bottom-over-top":
      from = [mx, q(y1, my)];
      to = [mx, q(y0, my)];
      break;
    case "diag-main":
      from = [q(x0, mx), q(y1, my)];
      to = [q(x1, mx), q(y0, my)];
      break;
    case "diag-anti":
      from = [q(x1, mx), q(y1, my)];
      to = [q(x0, mx), q(y0, my)];
      break;
  }
  const [fx, fy] = [sx(from[0]), sx(from[1])];
  const [tx, ty] = [sx(to[0]), sx(to[1])];
  // Curved arc bulging perpendicular to the direction of travel.
  const dx = tx - fx;
  const dy = ty - fy;
  const cx = (fx + tx) / 2 - dy * 0.35;
  const cy = (fy + ty) / 2 + dx * 0.35;
  return `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`;
}

export function PaperStepSvg({ folds, step, punches, label, className }: { folds: FoldKind[]; step: number; punches?: [number, number][]; label?: string; className?: string }) {
  const steps = foldSequence(folds);
  const markerId = `arrow-${useId().replace(/[:«»]/g, "")}`;
  const isFinal = step === steps.length;
  const region = isFinal ? steps[steps.length - 1].after : steps[step].before;
  return (
    <svg viewBox="0 0 100 100" className={className} role="img" aria-label={label}>
      <defs>
        <marker id={markerId} viewBox="0 0 10 10" refX="7" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 0 L 10 5 L 0 10 z" fill={INK} />
        </marker>
      </defs>
      {/* Outline of the unfolded sheet for reference */}
      <rect x={sx(0)} y={sx(0)} width={SHEET * SCALE} height={SHEET * SCALE} fill="none" stroke="var(--stim-mid)" strokeDasharray="2 2" strokeWidth={0.8} />
      <polygon points={pts(regionPolygon(region))} fill={PAPER} stroke={INK} strokeWidth="var(--stim-stroke)" strokeLinejoin="round" />
      {!isFinal && (
        <>
          <polygon points={pts(movingFlap(steps[step].before, steps[step].kind))} fill="var(--stim-light)" stroke="none" />
          <polygon points={pts(regionPolygon(region))} fill="none" stroke={INK} strokeWidth="var(--stim-stroke)" strokeLinejoin="round" />
          <line
            x1={sx(steps[step].line[0][0])}
            y1={sx(steps[step].line[0][1])}
            x2={sx(steps[step].line[1][0])}
            y2={sx(steps[step].line[1][1])}
            stroke={INK}
            strokeWidth={1.4}
            strokeDasharray="4 3"
          />
          <path d={foldArrow(steps[step].before, steps[step].kind)} fill="none" stroke={INK} strokeWidth={1.6} markerEnd={`url(#${markerId})`} />
        </>
      )}
      {isFinal &&
        (punches ?? []).map(([x, y], i) => <circle key={i} cx={PAD + x * (100 - 2 * PAD)} cy={PAD + y * (100 - 2 * PAD)} r={2.8} fill={INK} />)}
    </svg>
  );
}

export function HolesSvg({ holes, label, className }: { holes: [number, number][]; label?: string; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <rect x={sx(0)} y={sx(0)} width={SHEET * SCALE} height={SHEET * SCALE} fill={PAPER} stroke={INK} strokeWidth="var(--stim-stroke)" />
      {holes.map(([x, y], i) => (
        <circle key={i} cx={PAD + x * (100 - 2 * PAD)} cy={PAD + y * (100 - 2 * PAD)} r={2.8} fill={INK} />
      ))}
    </svg>
  );
}
