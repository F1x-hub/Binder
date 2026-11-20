import type { ReactNode } from 'react';

/** Линейные иконки из макетов, сетка 24×24, цвет берётся из currentColor. */
type IconProps = { size?: number; stroke?: number };

function Svg({ size = 20, stroke = 1.75, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function LogoIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6" width="11" height="15" rx="2" />
      <path d="M8 3.6l8.6-.9a2 2 0 0 1 2.2 1.8l1.2 11.3a2 2 0 0 1-1.8 2.2l-2.2.2" />
    </Svg>
  );
}

export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h9M17 7h3M4 17h3M11 17h9" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="17" r="2" />
    </Svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
  );
}

export function BackIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M15 18l-6-6 6-6" />
    </Svg>
  );
}

export function ScanIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2" />
      <path d="M7 12h10" />
    </Svg>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 10.5L12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </Svg>
  );
}

export function AlbumIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="6.5" height="8" rx="1.2" />
      <rect x="13.5" y="4" width="6.5" height="8" rx="1.2" />
      <rect x="4" y="15" width="6.5" height="5" rx="1.2" />
      <rect x="13.5" y="15" width="6.5" height="5" rx="1.2" />
    </Svg>
  );
}

export function DecksIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="7" y="3.5" width="10" height="14" rx="1.5" />
      <path d="M4.5 7v11.5a2 2 0 0 0 2 2h9" />
    </Svg>
  );
}

export function FriendsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6" />
      <path d="M15.5 5.6a3 3 0 0 1 0 5.8M17.5 14.9c1.6.6 2.7 2 3 4.6" />
    </Svg>
  );
}

export function BattleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13.5 3L5 13.5h6L10 21l8.5-10.5h-6z" />
    </Svg>
  );
}

export function UserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.4 3.6-5.2 7-5.2s6.2 1.8 7 5.2" />
    </Svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 5v14M5 12h14" />
    </Svg>
  );
}

export function MinusIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 12h14" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Svg>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
    </Svg>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M20 20l-4.2-4.2" />
    </Svg>
  );
}
