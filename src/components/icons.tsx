import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number, p: P) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  'aria-hidden': true,
  ...p,
});

export const MicIcon = ({ size = 14, ...p }: P) => (
  <svg
    {...base(size, p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
  >
    <rect x="9" y="3" width="6" height="12" rx="3" />
    <path d="M5 11a7 7 0 0014 0M12 18v3" />
  </svg>
);

export const StopIcon = ({ size = 32, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="3" />
  </svg>
);

export const PlayIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor">
    <path d="M7 4l13 8-13 8z" />
  </svg>
);

export const PauseIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor">
    <rect x="6" y="4" width="4" height="16" rx="1" />
    <rect x="14" y="4" width="4" height="16" rx="1" />
  </svg>
);

export const TrashIcon = ({ size = 17, ...p }: P) => (
  <svg
    {...base(size, p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
  </svg>
);

export const BackIcon = ({ size = 16, ...p }: P) => (
  <svg
    {...base(size, p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M15 5l-7 7 7 7" />
  </svg>
);

export const CloseIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const RefreshIcon = ({ size = 15, ...p }: P) => (
  <svg
    {...base(size, p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M20 12a8 8 0 10-3 6.2M20 4v6h-6" />
  </svg>
);

export const SparkIcon = ({ size = 15, ...p }: P) => (
  <svg {...base(size, p)} fill="currentColor">
    <path d="M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z" />
  </svg>
);

export const CopyIcon = ({ size = 14, ...p }: P) => (
  <svg {...base(size, p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 011-1h10" />
  </svg>
);

export const CheckIcon = ({ size = 14, ...p }: P) => (
  <svg
    {...base(size, p)}
    fill="none"
    stroke="currentColor"
    strokeWidth={2.4}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12l5 5 9-10" />
  </svg>
);

export const EyeIcon = ({ size = 14, off = false, ...p }: P & { off?: boolean }) => (
  <svg {...base(size, p)} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 4l16 16" />}
  </svg>
);
