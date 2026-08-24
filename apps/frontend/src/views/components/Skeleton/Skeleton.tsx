import React from 'react';
import './Skeleton.css';

interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  variant?: 'rectangular' | 'circular' | 'text';
  animation?: 'pulse' | 'wave' | 'none';
  style?: React.CSSProperties;
}

export default function Skeleton({
  className = '',
  width,
  height,
  variant = 'text',
  animation = 'wave',
  style,
}: SkeletonProps) {
  const classes = `skeleton skeleton--${variant} skeleton--${animation} ${className}`;
  
  const mergedStyle: React.CSSProperties = {
    ...style,
    ...(width && { width: typeof width === 'number' ? `${width}px` : width }),
    ...(height && { height: typeof height === 'number' ? `${height}px` : height }),
  };

  return <div className={classes} style={mergedStyle} />;
}
