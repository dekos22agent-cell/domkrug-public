import type { CSSProperties } from 'react';
import styles from './Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  radius?: string;
  className?: string;
}

export function Skeleton({ width = '100%', height = 14, radius, className }: SkeletonProps) {
  const style: CSSProperties = { width, height, ...(radius ? { borderRadius: radius } : {}) };
  return (
    <span
      className={[styles.skeleton, className ?? ''].filter(Boolean).join(' ')}
      style={style}
      aria-hidden="true"
    />
  );
}
