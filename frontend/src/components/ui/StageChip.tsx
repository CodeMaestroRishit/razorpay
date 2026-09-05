import type { CSSProperties, ReactNode } from "react";

/**
 * The floating "what's inside" chips in the hero — one per pipeline
 * stage. No stock photography (there isn't any real event photography to
 * use here, and this is a backend system, not a campus), so each chip is
 * an abstracted icon + a distinct gradient rather than a photo — same
 * visual role, honest content.
 */
export function StageChip({
  label,
  icon,
  gradient,
  rotate,
  style,
}: {
  label: string;
  icon: ReactNode;
  gradient: string;
  rotate: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={`absolute h-28 w-28 rounded-2xl shadow-xl ring-1 ring-white/10 ${gradient}`}
      style={{ ...style, transform: `rotate(${rotate}deg)` }}
    >
      <div className="flex h-full flex-col justify-between p-3">
        <div className="text-white/90">{icon}</div>
        <div className="text-xs font-bold uppercase tracking-wide text-white">{label}</div>
      </div>
    </div>
  );
}
