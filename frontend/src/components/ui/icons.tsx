// Minimal line icons, inline so the app has zero icon-package dependency.
// Stroke-based, 1.5px, matching the reference's clean line-icon language.

const base = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function IconRadar(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
    </svg>
  );
}

export function IconGauge(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M4 15a8 8 0 1 1 16 0" />
      <path d="M12 15l4-5" />
      <circle cx="12" cy="15" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function IconBrain(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M9 4a3 3 0 0 0-3 3v1a3 3 0 0 0-1 5.6V15a3 3 0 0 0 3 3h1" />
      <path d="M15 4a3 3 0 0 1 3 3v1a3 3 0 0 1 1 5.6V15a3 3 0 0 1-3 3h-1" />
      <path d="M9 4v14M15 4v14" />
    </svg>
  );
}

export function IconSpark(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M12 3l1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3z" />
    </svg>
  );
}

export function IconShield(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

export function IconBolt(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M13 3L5 14h6l-1 7 8-11h-6l1-7z" />
    </svg>
  );
}

export function IconChart(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
    </svg>
  );
}

export function IconLedger(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" {...base} className={props.className}>
      <rect x="5" y="3" width="14" height="18" rx="1.5" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

export function IconArrowUpRight(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" {...base} className={props.className}>
      <path d="M7 17L17 7M9 7h8v8" />
    </svg>
  );
}
