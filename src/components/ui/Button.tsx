import { ButtonHTMLAttributes, FC } from 'react';
import { clsx } from 'clsx';
// import { twMerge } from 'tailwind-merge'; 
// Even without tailwind, clsx can be used for conditional classes, but twMerge is for tailwind conflicts. I'll just use clsx since I'm doing vanilla CSS mostly but class checking is useful.
// Actually, I promised Vanilla CSS. I will use CSS Modules or just scoped classes if I can, but standard CSS is fine. I'll use `className` prop.

import './Button.css';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
}

export const Button: FC<ButtonProps> = ({ 
  children, 
  className, 
  variant = 'primary', 
  size = 'md', 
  isLoading, 
  disabled,
  ...props 
}) => {
  return (
    <button 
      className={clsx(
        'btn',
        `btn-${variant}`,
        `btn-${size}`,
        isLoading && 'btn-loading',
        className
      )}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <span className="spinner" /> : children}
    </button>
  );
};
