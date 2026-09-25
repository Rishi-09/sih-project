// Small inline SVG icon set. Replaces emoji/glyph stand-ins (✈, ◈, ×, +) that
// render inconsistently across platforms and read as placeholder content.
import { SVGProps } from "react";

function base(props: SVGProps<SVGSVGElement>) {
  return {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

export function IconAircraft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M22 16.5v-2l-8.5-5V5a1.5 1.5 0 0 0-3 0v4.5L2 14.5v2l8.5-2.6V19l-2.3 1.7v1.3l3.8-1 3.8 1v-1.3L13.5 19v-4.6l8.5 2.1z" />
    </svg>
  );
}

export function IconTwin(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 3 4 7v10l8 4 8-4V7l-8-4Z" />
      <path d="M4 7l8 4 8-4M12 11v10" />
    </svg>
  );
}

export function IconClose(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function IconPlus(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconChevronLeft(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function IconChevronRight(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  );
}

export function IconExpand(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3" />
    </svg>
  );
}

export function IconTrash(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...base(props)}>
      <path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0-1 14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1L5 6h14Z" />
    </svg>
  );
}
