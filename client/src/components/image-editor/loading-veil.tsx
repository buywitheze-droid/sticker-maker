/**
 * LoadingVeil
 *
 * WeTransfer-style loading overlay: a soft white veil with three translucent
 * SVG wave strips that drift left at different speeds, plus three gently
 * bobbing dots. Animates only `transform` and `opacity` for compositor-only
 * performance. Respects `prefers-reduced-motion`.
 */

import type { CSSProperties, ReactNode } from "react";

/* ─── Wave configuration ─────────────────────────────────────────────────── */

/** Each entry describes one drifting wave layer. */
interface WaveCfg {
  /** CSS colour of the fill (low-opacity rgba recommended). */
  color: string;
  /** Full animation cycle in seconds. */
  duration: number;
  /**
   * Vertical midpoint of the wave as a percentage of the overlay height
   * (0 = top, 100 = bottom).  Values > 50 push the fill toward the bottom,
   * leaving the centre area clear for the dots.
   */
  midY: number;
  /**
   * Half-swing of the wave in the same percentage units.
   * e.g. midY=60, amplitude=18 → oscillates between 42% and 78% of height.
   */
  amplitude: number;
}

const WAVES: WaveCfg[] = [
  // Fast, highest, cyan tint
  { color: "rgba(6,182,212,0.11)",   duration: 7,  midY: 54, amplitude: 17 },
  // Medium, middle, indigo tint
  { color: "rgba(99,102,241,0.09)",  duration: 12, midY: 65, amplitude: 19 },
  // Slow, lowest, blue tint
  { color: "rgba(59,130,246,0.08)",  duration: 19, midY: 75, amplitude: 15 },
];

/* ─── Dot configuration ──────────────────────────────────────────────────── */

const DOTS = [
  { delay: "0s",    color: "rgba(6,182,212,0.75)" },
  { delay: "0.18s", color: "rgba(99,102,241,0.65)" },
  { delay: "0.36s", color: "rgba(59,130,246,0.70)" },
];

/* ─── Keyframes (injected once per component mount) ─────────────────────── */

const KEYFRAMES = `
@keyframes veilSlide {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@keyframes veilBob {
  0%, 100% { transform: translateY(0px); }
  50%       { transform: translateY(-7px); }
}
@media (prefers-reduced-motion: reduce) {
  .veil-wave { animation-play-state: paused !important; }
  .veil-dot  { animation: none !important; transform: translateY(0px) !important; }
}
`;

/* ─── Component ──────────────────────────────────────────────────────────── */

/**
 * @param shown     When false the overlay is invisible (opacity: 0) but still
 *                  mounted so it can fade out gracefully.
 * @param fadeDuration  Transition duration in milliseconds (default 180).
 * @param fixed     Use `position: fixed` instead of `position: absolute`.
 * @param className Extra Tailwind classes applied to the root element (use for
 *                  z-index, pointer-events overrides, etc.).
 * @param children  Optional label rendered below the dots.
 */
export function LoadingVeil({
  shown,
  fadeDuration = 180,
  fixed = false,
  className = "",
  children,
}: {
  shown: boolean;
  fadeDuration?: number;
  fixed?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <div
      aria-hidden
      className={`${fixed ? "fixed" : "absolute"} inset-0 overflow-hidden flex items-center justify-center pointer-events-none ${className}`}
      style={{
        backgroundColor: "rgba(255,255,255,0.88)",
        opacity: shown ? 1 : 0,
        transition: `opacity ${fadeDuration}ms ease`,
      }}
    >
      {/* Keyframe injection — idempotent if this component is mounted twice */}
      {/* eslint-disable-next-line react/no-danger */}
      <style dangerouslySetInnerHTML={{ __html: KEYFRAMES }} />

      {/* ── Wave layers ─────────────────────────────────────────────────── */}
      {/*
       * Each wave is a 200%-wide strip that slides left by exactly 50% of its
       * own width (= 100% of the viewport width = one full wave period), then
       * loops — creating a seamless infinite drift.
       *
       * The SVG uses viewBox="0 0 2880 100" (2 × 1440-unit periods) with
       * preserveAspectRatio="none" so it stretches to fill whatever height the
       * host overlay has.  midY / amplitude are expressed in those 0-100 units.
       */}
      <div className="absolute inset-0 overflow-hidden">
        {WAVES.map((w, idx) => {
          const mid = w.midY;
          const amp = w.amplitude;

          // Smooth sine-like cubic bezier wave across 2 periods (0→1440→2880).
          // Control points are placed at 1/3 and 2/3 of each half-period so
          // the curve approximates a true sinusoid.
          const path = [
            `M 0 ${mid}`,
            // Period 1: arch up
            `C 240 ${mid - amp} 480 ${mid - amp} 720 ${mid}`,
            // Period 1: arch down
            `C 960 ${mid + amp} 1200 ${mid + amp} 1440 ${mid}`,
            // Period 2: arch up
            `C 1680 ${mid - amp} 1920 ${mid - amp} 2160 ${mid}`,
            // Period 2: arch down
            `C 2400 ${mid + amp} 2640 ${mid + amp} 2880 ${mid}`,
            // Fill to bottom of viewBox
            `L 2880 100 L 0 100 Z`,
          ].join(" ");

          return (
            <div
              key={idx}
              className="veil-wave absolute inset-y-0 left-0"
              style={
                {
                  width: "200%",
                  animationName: "veilSlide",
                  animationDuration: `${w.duration}s`,
                  animationTimingFunction: "linear",
                  animationIterationCount: "infinite",
                  willChange: "transform",
                } as CSSProperties
              }
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 2880 100"
                preserveAspectRatio="none"
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                }}
              >
                <path d={path} fill={w.color} />
              </svg>
            </div>
          );
        })}
      </div>

      {/* ── Centre content ───────────────────────────────────────────────── */}
      <div className="relative z-10 flex flex-col items-center gap-3">
        {/* Bobbing dots */}
        <div className="flex items-center gap-[10px]">
          {DOTS.map((d, idx) => (
            <span
              key={idx}
              className="veil-dot block rounded-full"
              style={
                {
                  width: 9,
                  height: 9,
                  backgroundColor: d.color,
                  animationName: "veilBob",
                  animationDuration: "1.25s",
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                  animationDelay: d.delay,
                  willChange: "transform",
                } as CSSProperties
              }
            />
          ))}
        </div>

        {/* Optional label slot */}
        {children != null && (
          <div className="text-[12px] font-semibold text-gray-400 tracking-wide select-none">
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
