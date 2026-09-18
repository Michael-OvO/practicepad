import type { ReactNode } from "react";

function Icon({ children, size = 16 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export const PlayIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4.5 2.8v10.4L13 8z" fill="currentColor" stroke="none" />
  </Icon>
);

export const PauseIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 3h2.8v10H4zM9.200 3H12v10H9.200z" fill="currentColor" stroke="none" />
  </Icon>
);

/** Counter-clockwise arrow: back to the start. */
export const ResetIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M3 8a5 5 0 1 0 5-5 5.400 5.400 0 0 0-3.740 1.520L3 5.800" />
    <path d="M3 3v2.800h2.800" />
  </Icon>
);

export const ChevronDownIcon = ({ size }: { size?: number }) => (
  <Icon size={size}>
    <path d="M4 6.200l4 4 4-4" />
  </Icon>
);

export const StopIcon = () => (
  <Icon>
    <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" fill="currentColor" stroke="none" />
  </Icon>
);

export const PlusIcon = () => (
  <Icon>
    <path d="M8 3.5v9M3.5 8h9" />
  </Icon>
);

export const PencilIcon = () => (
  <Icon>
    <path d="M10.8 2.7l2.5 2.5L5.5 13H3v-2.5z" />
  </Icon>
);

export const TrashIcon = () => (
  <Icon>
    <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />
  </Icon>
);

/** Stacked sheets: the list of pads. */
export const PadsIcon = () => (
  <Icon size={18}>
    <path d="M5.5 2.5h5l2.5 2.5v6.5a1 1 0 0 1-1 1h-6.500a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1z" />
    <path d="M10.500 2.500v2.500h2.500" />
    <path d="M2.500 5.500v7a1.500 1.500 0 0 0 1.500 1.500h6" />
  </Icon>
);

export const SearchIcon = () => (
  <Icon>
    <circle cx="7" cy="7" r="4" />
    <path d="M10 10l3.200 3.200" />
  </Icon>
);

export const SunIcon = () => (
  <Icon size={18}>
    <circle cx="8" cy="8" r="2.800" />
    <path d="M8 1.500v1.500M8 13v1.500M1.500 8H3M13 8h1.500M3.400 3.400l1.100 1.100M11.500 11.500l1.100 1.100M3.400 12.600l1.100-1.100M11.500 4.500l1.100-1.100" />
  </Icon>
);

export const MoonIcon = () => (
  <Icon size={18}>
    <path d="M13.200 9.600A5.500 5.500 0 0 1 6.400 2.800a5.500 5.500 0 1 0 6.800 6.800z" />
  </Icon>
);

/** The app's mark: a prompt chevron and cursor. */
export const BrandMark = () => (
  <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="7" fill="var(--accent)" />
    <path
      d="M9 11l6 5-6 5M17.500 21.500h6"
      fill="none"
      stroke="var(--on-accent)"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
