import React from 'react';

interface SkeletonProps {
  className?: string;
  style?: React.CSSProperties;
  width?: string | number;
  height?: string | number;
  borderRadius?: string | number;
  lines?: number;
  gap?: number;
}

// ── Base Skeleton ─────────────────────────────────────────────
export function Skeleton({ className = '', style, width, height, borderRadius }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{
        width: width ?? '100%',
        height: height ?? '1rem',
        borderRadius: borderRadius ?? 'var(--radius-sm)',
        ...style,
      }}
    />
  );
}

// ── Text Lines Skeleton ───────────────────────────────────────
export function SkeletonText({ lines = 3, gap = 10 }: { lines?: number; gap?: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap }}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          height="0.9rem"
          width={i === lines - 1 ? '65%' : '100%'}
        />
      ))}
    </div>
  );
}

// ── Card Skeleton (Dashboard card style) ──────────────────────
export function SkeletonCard() {
  return (
    <div
      className="skeleton"
      style={{
        borderRadius: 'var(--radius-lg)',
        padding: '1.5rem',
        height: 160,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'rgba(255,255,255,0.03)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <Skeleton width={40} height={40} borderRadius="50%" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Skeleton height="0.9rem" width="50%" />
          <Skeleton height="0.75rem" width="35%" />
        </div>
      </div>
      <Skeleton height="2.5rem" borderRadius="var(--radius-sm)" />
      <Skeleton height="0.75rem" width="80%" />
    </div>
  );
}

// ── Site List Item Skeleton ───────────────────────────────────
export function SkeletonSiteItem() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: '1rem 1.5rem',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <Skeleton width={48} height={48} borderRadius="var(--radius-md)" />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Skeleton height="0.9rem" width="40%" />
        <Skeleton height="0.75rem" width="60%" />
      </div>
      <Skeleton width={80} height={28} borderRadius="var(--radius-full)" />
    </div>
  );
}

// ── Dashboard Skeleton (YouTube-style full page) ──────────────
export function SkeletonDashboard() {
  return (
    <div style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: 32 }}>
      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 20 }}>
        {[...Array(4)].map((_, i) => (
          <SkeletonCard key={i} />
        ))}
      </div>

      {/* Chart placeholder */}
      <div
        className="skeleton"
        style={{
          height: 280,
          borderRadius: 'var(--radius-lg)',
          background: 'rgba(255,255,255,0.03)',
        }}
      />

      {/* List header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Skeleton height="1.25rem" width={160} />
        <Skeleton height="2.25rem" width={120} borderRadius="var(--radius-md)" />
      </div>

      {/* List items */}
      <div
        style={{
          background: 'rgba(255,255,255,0.02)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-lg)',
          overflow: 'hidden',
        }}
      >
        {[...Array(5)].map((_, i) => (
          <SkeletonSiteItem key={i} />
        ))}
      </div>
    </div>
  );
}

// ── Wizard Skeleton ───────────────────────────────────────────
export function SkeletonWizard() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 32, padding: '2rem' }}>
      {/* Step indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
        {[...Array(7)].map((_, i) => (
          <React.Fragment key={i}>
            <Skeleton width={36} height={36} borderRadius="50%" />
            {i < 6 && <Skeleton width={60} height={3} />}
          </React.Fragment>
        ))}
      </div>

      {/* Content */}
      <Skeleton height="2rem" width="40%" style={{ margin: '0 auto' }} />
      <Skeleton height="1rem" width="60%" style={{ margin: '0 auto' }} />

      <Skeleton height={200} borderRadius="var(--radius-xl)" />

      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        <Skeleton width={100} height={44} borderRadius="var(--radius-md)" />
        <Skeleton width={140} height={44} borderRadius="var(--radius-md)" />
      </div>
    </div>
  );
}
