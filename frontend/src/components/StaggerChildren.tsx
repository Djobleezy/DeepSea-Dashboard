import React from 'react';

interface Props {
  children: React.ReactNode;
  /** Delay between each child (ms) */
  stagger?: number;
  /** Base animation duration (ms) */
  duration?: number;
  /** Animation name from global.css */
  animation?: 'stagger-in' | 'stagger-in-scale';
  /** Optional CSS class on wrapper */
  className?: string;
  /** Optional inline style on wrapper */
  style?: React.CSSProperties;
}

/**
 * Wraps children and applies staggered entrance animation to each.
 * Each direct child gets an increasing animation-delay.
 */
export const StaggerChildren: React.FC<Props> = ({
  children,
  stagger = 50,
  duration = 350,
  animation = 'stagger-in',
  className,
  style,
}) => {
  return (
    <div className={className} style={style}>
      {React.Children.map(children, (child, i) => {
        if (!React.isValidElement(child)) return child;
        return (
          <div
            style={{
              animation: `${animation} ${duration}ms ease-out ${i * stagger}ms both`,
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
};
