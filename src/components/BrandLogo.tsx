import React from 'react';

interface BrandLogoProps {
  showTagline?: boolean;
  subtitle?: string;
  size?: 'sm' | 'md' | 'lg';
}

export function BrandLogo({ showTagline = false, subtitle, size = 'md' }: BrandLogoProps) {
  const iconDim = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-10 h-10' : 'w-8 h-8';
  const titleSize =
    size === 'sm' ? 'text-base' : size === 'lg' ? 'text-xl' : 'text-lg';

  return (
    <div className="inline-flex items-center gap-2.5 min-w-0">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
        fill="none"
        aria-hidden="true"
        className={`${iconDim} shrink-0 rounded-lg`}
      >
        <rect width="512" height="512" rx="112" fill="#047857" />
        <circle cx="256" cy="256" r="154" stroke="#ffffff" strokeWidth="26" />
        <circle cx="256" cy="256" r="96" stroke="#a7f3d0" strokeWidth="14" strokeDasharray="14 14" />
        <path
          d="M256 176c44 0 80 36 80 80-44 0-80-36-80-80zm0 0c-44 0-80 36-80 80 44 0 80-36 80-80zm0 80v84"
          stroke="#ffffff"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <div className="min-w-0">
        <div className={`${titleSize} font-bold tracking-tight text-slate-900 leading-none whitespace-nowrap`}>
          SMARTPLATE
        </div>
        {showTagline && (
          <div className="mt-1 text-[11px] font-medium text-emerald-700 leading-none truncate">
            Eat Smart – Live Healthy
          </div>
        )}
        {subtitle && (
          <div className="mt-1 text-xs text-slate-500 leading-tight truncate">{subtitle}</div>
        )}
      </div>
    </div>
  );
}
