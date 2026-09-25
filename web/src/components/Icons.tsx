import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="24"
      height="24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  );
}

export const BoardIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M3 12h3.5l2.5-7 4.5 14 2.5-7H21" />
  </Icon>
);

export const BeanIcon = (p: IconProps) => (
  <Icon {...p}>
    <g transform="rotate(35 12 12)">
      <ellipse cx="12" cy="12" rx="6.2" ry="9" />
      <path d="M12 3.4c-2.4 2.9-2.4 5.3 0 8.6s2.4 5.7 0 8.6" />
    </g>
  </Icon>
);

export const RecipeIcon = (p: IconProps) => (
  <Icon {...p}>
    <rect x="5" y="4" width="14" height="17" rx="2.5" />
    <path d="M9 3h6v3H9zM8.5 11h7M8.5 14.5h7M8.5 18h4" />
  </Icon>
);

export const BrewIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="12" cy="13.5" r="7.5" />
    <path d="M12 13.5V9.5M9.5 2.5h5M18.2 6.8l1.4-1.4" />
  </Icon>
);

export const DuelIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M12 4v16M8 20.5h8M4.5 7.5h15" />
    <path d="M4.5 7.5 2 14a2.6 2.6 0 0 0 5 0z" />
    <path d="M19.5 7.5 17 14a2.6 2.6 0 0 0 5 0z" />
  </Icon>
);

export const CoachIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M11 3.5 12.8 8.2 17.5 10 12.8 11.8 11 16.5 9.2 11.8 4.5 10 9.2 8.2z" />
    <path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </Icon>
);

export const BackIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
);

export const ChevronIcon = (p: IconProps) => (
  <Icon {...p} width={20} height={20}>
    <path d="M9 5l7 7-7 7" />
  </Icon>
);

export const CloseIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const DeleteIcon = (p: IconProps) => (
  <Icon {...p} width={28} height={28}>
    <path d="M9 5h11v14H9l-6-7z" />
    <path d="M12.5 9.5l5 5M17.5 9.5l-5 5" />
  </Icon>
);

export const AlertIcon = (p: IconProps) => (
  <Icon {...p} width={18} height={18} style={{ flexShrink: 0, marginTop: 2 }}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7.5v5.5M12 16.5v.01" />
  </Icon>
);

/** The app mark: an AeroPress chamber seen side-on, with a drop. */
export const LogoMark = (p: IconProps) => (
  <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...p}>
    <rect width="32" height="32" rx="8" fill="var(--accent)" />
    <path d="M10 7h12v2.5H10z" fill="var(--accent-ink)" />
    <path d="M11 11h10v10.5a2 2 0 0 1-2 2h-6a2 2 0 0 1-2-2z" fill="none" stroke="var(--accent-ink)" strokeWidth="2" />
    <path d="M16 25.5c-1 1.3-1.5 2.2-1.5 2.8a1.5 1.5 0 0 0 3 0c0-.6-.5-1.5-1.5-2.8z" fill="var(--accent-ink)" />
  </svg>
);
