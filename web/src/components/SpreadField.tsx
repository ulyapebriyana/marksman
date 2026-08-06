import { useEffect, useMemo, useRef } from "react";
import type { Pool } from "../api/types";
import { momentum1h } from "../lib/poolMath";
import { usePrefersReducedMotion } from "../hooks/useMisc";

/* --------------------------------------------------------------------------
   The Spread Field
   --------------------------------------------------------------------------
   Marksman's whole reason to exist is the gap between a tokenized stock and
   the equity it tracks. This renders that gap literally: every pool is a node
   suspended in a measurement volume, and every tokenized stock is drawn as a
   *pair* — the on-chain price and a parity marker — joined by a strut whose
   length is the premium. A rangefinder reticle walks the field and reads out
   whatever it is currently sighted on.

   Hand-rolled perspective projection on a 2D canvas: a full WebGL runtime
   would be ~600 kB for a scene of a few hundred points and two dozen lines.
   -------------------------------------------------------------------------- */

export interface FieldNode {
  id: string;
  label: string;
  sub: string;
  /** Normalised world position, each roughly -1…1. */
  x: number;
  y: number;
  z: number;
  /** Premium in percent. Non-null nodes get a parity strut. */
  premium: number | null;
  /** 1h price change, used for the readout when no premium is available. */
  move: number | null;
  hot: boolean;
  tokenized: boolean;
  /** 0…100, drives node radius. */
  weight: number;
}

interface Palette {
  line: string;
  txt0: string;
  txt2: string;
  reticle: string;
  coat: string;
  bloom: string;
  flare: string;
}

const AXIS_LABELS = { x: "LIQUIDITY", y: "1H MOVE", z: "VOLUME" };

/* -------------------------------------------------------------------------- */
/* Data                                                                        */
/* -------------------------------------------------------------------------- */

/** Deterministic pseudo-random so the idle field is stable between renders. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const IDLE_TICKERS = [
  ["NVDA", "Nvidia"],
  ["AAPL", "Apple"],
  ["TSLA", "Tesla"],
  ["MSFT", "Microsoft"],
  ["AMZN", "Amazon"],
];

/** The field shown before live pools arrive — shaped like a real scan, clearly idle. */
export function idleField(): FieldNode[] {
  const rand = seeded(20260806);
  const nodes: FieldNode[] = [];

  for (let i = 0; i < 46; i += 1) {
    nodes.push({
      id: `idle-${i}`,
      label: "",
      sub: "",
      x: (rand() - 0.5) * 2,
      y: (rand() - 0.5) * 1.35,
      z: (rand() - 0.5) * 2,
      premium: null,
      move: (rand() - 0.45) * 18,
      hot: rand() > 0.93,
      tokenized: false,
      weight: 18 + rand() * 55,
    });
  }

  IDLE_TICKERS.forEach(([ticker, name], i) => {
    const spread = (rand() - 0.42) * 4.4;
    nodes.push({
      id: `idle-stock-${ticker}`,
      label: ticker,
      sub: name,
      x: -0.78 + (i / (IDLE_TICKERS.length - 1)) * 1.56,
      y: 0.12 + (rand() - 0.5) * 0.5,
      z: -0.42 + (rand() - 0.5) * 0.8,
      premium: spread,
      move: (rand() - 0.45) * 12,
      hot: Math.abs(spread) > 2.4,
      tokenized: true,
      weight: 62 + rand() * 30,
    });
  });

  return nodes;
}

/** Maps a live scan onto the measurement volume: liquidity × momentum × volume. */
export function buildField(pools: Pool[]): FieldNode[] {
  if (pools.length === 0) return idleField();

  const logLiq = pools.map((p) => Math.log10(Math.max(1, p.liquidityUsd)));
  const logVol = pools.map((p) => Math.log10(Math.max(1, p.volume.h24)));
  const range = (values: number[]) => {
    const min = Math.min(...values);
    const max = Math.max(...values);
    return { min, span: max - min || 1 };
  };
  const liqRange = range(logLiq);
  const volRange = range(logVol);

  return pools.map((pool, i) => {
    const move = momentum1h(pool) ?? 0;
    return {
      id: pool.address,
      label: pool.stockTicker ?? pool.baseToken.symbol ?? "?",
      sub: pool.isTokenizedStock ? (pool.stockName ?? "") : (pool.quoteToken.symbol ?? ""),
      x: ((logLiq[i] - liqRange.min) / liqRange.span) * 1.9 - 0.95,
      y: Math.max(-0.85, Math.min(0.85, move / 14)),
      z: ((logVol[i] - volRange.min) / volRange.span) * 1.9 - 0.95,
      premium: pool.premiumPct,
      move: momentum1h(pool),
      hot: pool.signalStatus === "hot",
      tokenized: pool.isTokenizedStock,
      weight: pool.score.total,
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Renderer                                                                    */
/* -------------------------------------------------------------------------- */

function readPalette(): Palette {
  const s = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => s.getPropertyValue(name).trim() || fallback;
  return {
    line: read("--c-line-2", "#332c50"),
    txt0: read("--c-txt-0", "#f2effa"),
    txt2: read("--c-txt-2", "#857ea6"),
    reticle: read("--c-reticle", "#ffb324"),
    coat: read("--c-coat", "#7a6bff"),
    bloom: read("--c-bloom", "#2fd8b4"),
    flare: read("--c-flare", "#ff5c7a"),
  };
}

/** Hex (#rgb/#rrggbb) → rgba() at the given alpha. Non-hex passes through. */
function withAlpha(color: string, alpha: number): string {
  if (!color.startsWith("#")) return color;
  let hex = color.slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const n = parseInt(hex, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function SpreadField({
  nodes,
  className,
  interactive = true,
  density = 1,
}: {
  nodes: FieldNode[];
  className?: string;
  interactive?: boolean;
  /** Scales node size + grid extent; the compact console version runs smaller. */
  density?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const nodesRef = useRef(nodes);
  const reducedMotion = usePrefersReducedMotion();

  nodesRef.current = nodes;

  // Tokenized nodes with a live premium are the most interesting thing to sight.
  // Without an equity feed there are none, so the instrument falls back to hot
  // pools and then to the highest-scoring ones — it always reads out whatever
  // it actually has, rather than going blank.
  const sightables = useMemo(() => {
    const withSpread = nodes.filter((n) => n.tokenized && n.premium != null);
    if (withSpread.length > 0) return withSpread;
    const hot = nodes.filter((n) => n.hot);
    if (hot.length > 0) return hot.slice(0, 6);
    return [...nodes].sort((a, b) => b.weight - a.weight).slice(0, 5);
  }, [nodes]);
  const sightablesRef = useRef(sightables);
  sightablesRef.current = sightables;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let palette = readPalette();
    let width = 0;
    let height = 0;
    let frame = 0;
    let running = true;

    const pointer = { x: 0, y: 0, active: false };
    const view = { yaw: 0, pitch: -0.16, targetYaw: 0, targetPitch: -0.16 };

    /* --- sizing --- */
    const dpr = () => Math.min(window.devicePixelRatio || 1, 2);
    function resize() {
      const rect = canvas!.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      canvas!.width = Math.round(width * dpr());
      canvas!.height = Math.round(height * dpr());
      ctx!.setTransform(dpr(), 0, 0, dpr(), 0, 0);
    }
    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    /* --- theme --- */
    const themeObserver = new MutationObserver(() => {
      palette = readPalette();
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    /* --- pause offscreen / hidden --- */
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      running = entry.isIntersecting;
      if (running) loop();
    });
    intersectionObserver.observe(canvas);

    function onVisibility() {
      running = document.visibilityState === "visible";
      if (running) loop();
    }
    document.addEventListener("visibilitychange", onVisibility);

    /* --- pointer parallax --- */
    function onPointerMove(event: PointerEvent) {
      const rect = canvas!.getBoundingClientRect();
      pointer.x = (event.clientX - rect.left) / rect.width - 0.5;
      pointer.y = (event.clientY - rect.top) / rect.height - 0.5;
      pointer.active = true;
    }
    function onPointerLeave() {
      pointer.active = false;
    }
    if (interactive) {
      canvas.addEventListener("pointermove", onPointerMove);
      canvas.addEventListener("pointerleave", onPointerLeave);
    }

    /* --- projection --- */
    const CAMERA_DISTANCE = 3.5;

    function project(x: number, y: number, z: number) {
      const cosY = Math.cos(view.yaw);
      const sinY = Math.sin(view.yaw);
      const rx = x * cosY - z * sinY;
      const rz = x * sinY + z * cosY;

      const cosP = Math.cos(view.pitch);
      const sinP = Math.sin(view.pitch);
      const ry = y * cosP - rz * sinP;
      const depth = y * sinP + rz * cosP + CAMERA_DISTANCE;

      const focal = Math.min(width, height * 1.5) * 0.82;
      const scale = focal / Math.max(0.35, depth);
      return { sx: width / 2 + rx * scale, sy: height / 2 - ry * scale, depth, scale };
    }

    /** Farther things dim toward the background — a depth cue, not decoration. */
    function fog(depth: number): number {
      return Math.max(0.05, Math.min(1, 1.55 - (depth - CAMERA_DISTANCE) * 0.55));
    }

    /* --- pieces --- */
    function drawGrid() {
      const extent = 1.55 * density;
      const step = extent / 5;
      const floor = -1.05;

      ctx!.lineWidth = 1;
      for (let i = -5; i <= 5; i += 1) {
        const t = i * step;
        for (const axis of ["x", "z"] as const) {
          const a = axis === "x" ? project(t, floor, -extent) : project(-extent, floor, t);
          const b = axis === "x" ? project(t, floor, extent) : project(extent, floor, t);
          const alpha = 0.5 * fog((a.depth + b.depth) / 2) * (i === 0 ? 1.6 : 1);
          ctx!.strokeStyle = withAlpha(i === 0 ? palette.coat : palette.line, Math.min(0.55, alpha));
          ctx!.beginPath();
          ctx!.moveTo(a.sx, a.sy);
          ctx!.lineTo(b.sx, b.sy);
          ctx!.stroke();
        }
      }
    }

    /** Corner brackets + readout. The instrument sighting something specific. */
    function drawReticle(node: FieldNode, sx: number, sy: number, radius: number, pulse: number) {
      const reach = Math.max(22, radius * 3.4);
      const arm = reach * 0.42;
      const color = palette.reticle;

      ctx!.strokeStyle = withAlpha(color, 0.9);
      ctx!.lineWidth = 1.25;
      for (const [dx, dy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ]) {
        const cx = sx + dx * reach;
        const cy = sy + dy * reach;
        ctx!.beginPath();
        ctx!.moveTo(cx - dx * arm, cy);
        ctx!.lineTo(cx, cy);
        ctx!.lineTo(cx, cy - dy * arm);
        ctx!.stroke();
      }

      // Expanding ranging ring.
      ctx!.strokeStyle = withAlpha(color, 0.32 * (1 - pulse));
      ctx!.lineWidth = 1;
      ctx!.beginPath();
      ctx!.arc(sx, sy, reach * (0.55 + pulse * 0.85), 0, Math.PI * 2);
      ctx!.stroke();

      // Readout, leadered off to the right. Premium when the equity feed gave
      // us one, otherwise the 1h move, otherwise the score.
      const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
      let readout: string;
      let readoutTone: string;
      if (node.premium != null) {
        readout = signed(node.premium);
        readoutTone = node.premium >= 0 ? palette.bloom : palette.flare;
      } else if (node.move != null) {
        readout = `${signed(node.move)} 1h`;
        readoutTone = node.move >= 0 ? palette.bloom : palette.flare;
      } else {
        readout = `score ${node.weight.toFixed(0)}`;
        readoutTone = palette.txt2;
      }

      const leaderX = sx + reach + 10;
      const leaderEnd = leaderX + 26;

      ctx!.strokeStyle = withAlpha(color, 0.55);
      ctx!.beginPath();
      ctx!.moveTo(leaderX, sy);
      ctx!.lineTo(leaderEnd, sy);
      ctx!.stroke();

      ctx!.textBaseline = "middle";
      ctx!.textAlign = "left";
      ctx!.font = '600 12px "JetBrains Mono", ui-monospace, monospace';
      ctx!.fillStyle = palette.txt0;
      ctx!.fillText(node.label || "—", leaderEnd + 7, sy - 7);

      ctx!.font = '500 11px "JetBrains Mono", ui-monospace, monospace';
      ctx!.fillStyle = readoutTone;
      ctx!.fillText(readout, leaderEnd + 7, sy + 8);
    }

    function draw(time: number) {
      ctx!.clearRect(0, 0, width, height);
      if (width === 0 || height === 0) return;

      const t = time / 1000;

      // Ease toward the pointer; drift slowly on its own when untouched.
      view.targetYaw = pointer.active ? pointer.x * 0.85 : Math.sin(t * 0.12) * 0.42;
      view.targetPitch = pointer.active ? -0.16 - pointer.y * 0.45 : -0.16 + Math.sin(t * 0.09) * 0.07;
      if (reducedMotion) {
        view.yaw = pointer.active ? view.targetYaw : 0.3;
        view.pitch = pointer.active ? view.targetPitch : -0.16;
      } else {
        view.yaw += (view.targetYaw - view.yaw) * 0.045;
        view.pitch += (view.targetPitch - view.pitch) * 0.045;
      }

      drawGrid();

      // The reticle walks one tokenized pool at a time, ~3.4s each.
      const sighted = sightablesRef.current;
      const sightedNode = sighted.length > 0 ? sighted[Math.floor(t / 3.4) % sighted.length] : null;
      const pulse = (t % 3.4) / 3.4;

      type Drawable = { node: FieldNode; sx: number; sy: number; depth: number; scale: number };
      const drawables: Drawable[] = [];

      for (const node of nodesRef.current) {
        const p = project(node.x * density, node.y, node.z * density);
        if (p.depth <= 0.4) continue;
        drawables.push({ node, sx: p.sx, sy: p.sy, depth: p.depth, scale: p.scale });
      }
      drawables.sort((a, b) => b.depth - a.depth);

      for (const item of drawables) {
        const { node, sx, sy, depth, scale } = item;
        const alpha = fog(depth);
        const radius = Math.max(1, ((node.weight / 100) * 2.9 + 1.1) * (scale / 260) * density);

        // Tokenized stock: draw the parity marker and the strut that separates
        // them. The strut length *is* the premium — that is the whole picture.
        if (node.tokenized && node.premium != null) {
          const gap = Math.max(-0.62, Math.min(0.62, node.premium / 9));
          const parity = project(node.x * density, node.y - gap, node.z * density);
          const gapColor = node.premium >= 0 ? palette.bloom : palette.flare;

          ctx!.strokeStyle = withAlpha(gapColor, 0.55 * alpha);
          ctx!.lineWidth = 1.4;
          ctx!.beginPath();
          ctx!.moveTo(sx, sy);
          ctx!.lineTo(parity.sx, parity.sy);
          ctx!.stroke();

          // Parity tick — a hollow marker meaning "where the equity actually is".
          const tick = Math.max(3, radius * 0.9);
          ctx!.strokeStyle = withAlpha(palette.txt2, 0.75 * alpha);
          ctx!.lineWidth = 1.2;
          ctx!.beginPath();
          ctx!.moveTo(parity.sx - tick, parity.sy);
          ctx!.lineTo(parity.sx + tick, parity.sy);
          ctx!.stroke();
        }

        const color = node.hot ? palette.flare : node.tokenized ? palette.reticle : palette.coat;

        // Tight bloom, then a hard core. The bloom is a hint of coated glass,
        // not a halo — the point has to stay a point for the field to read as
        // measurement rather than atmosphere.
        const bloomRadius = radius * 2.3;
        const glow = ctx!.createRadialGradient(sx, sy, radius * 0.75, sx, sy, bloomRadius);
        glow.addColorStop(0, withAlpha(color, 0.24 * alpha));
        glow.addColorStop(1, withAlpha(color, 0));
        ctx!.fillStyle = glow;
        ctx!.beginPath();
        ctx!.arc(sx, sy, bloomRadius, 0, Math.PI * 2);
        ctx!.fill();

        ctx!.fillStyle = withAlpha(color, Math.min(1, alpha * 1.25));
        ctx!.beginPath();
        ctx!.arc(sx, sy, radius, 0, Math.PI * 2);
        ctx!.fill();

        // Nearby nodes get a crisp rim so they read as machined, not painted.
        if (alpha > 0.55) {
          ctx!.strokeStyle = withAlpha(color, Math.min(1, alpha));
          ctx!.lineWidth = 0.75;
          ctx!.beginPath();
          ctx!.arc(sx, sy, radius + 1.2, 0, Math.PI * 2);
          ctx!.stroke();
        }

        if (node.hot) {
          ctx!.strokeStyle = withAlpha(palette.flare, 0.5 * alpha * (1 - pulse));
          ctx!.lineWidth = 1;
          ctx!.beginPath();
          ctx!.arc(sx, sy, radius + 4 + pulse * 9, 0, Math.PI * 2);
          ctx!.stroke();
        }

        if (sightedNode && node.id === sightedNode.id) {
          drawReticle(node, sx, sy, radius, pulse);
        }
      }

      drawAxisKey();
    }

    /** Names what the three axes mean, engraved into the lower-left corner. */
    function drawAxisKey() {
      if (width < 460) return;
      ctx!.font = '500 9px "JetBrains Mono", ui-monospace, monospace';
      ctx!.textAlign = "left";
      ctx!.textBaseline = "alphabetic";
      ctx!.fillStyle = withAlpha(palette.txt2, 0.75);
      const entries = [`X ${AXIS_LABELS.x}`, `Y ${AXIS_LABELS.y}`, `Z ${AXIS_LABELS.z}`];
      entries.forEach((entry, i) => {
        ctx!.fillText(entry, 16, height - 16 - (entries.length - 1 - i) * 13);
      });
    }

    function loop(time = performance.now()) {
      if (!running) return;
      draw(time);
      frame = requestAnimationFrame(loop);
    }
    loop();

    return () => {
      running = false;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerleave", onPointerLeave);
    };
  }, [interactive, density, reducedMotion]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      role="img"
      aria-label={
        sightables.length > 0
          ? `Live field of ${nodes.length} pools. ${sightables.length} tokenized stocks are shown with a strut marking their premium against the equity they track.`
          : `Field of ${nodes.length} scanned liquidity pools positioned by liquidity, one-hour move, and volume.`
      }
    />
  );
}
