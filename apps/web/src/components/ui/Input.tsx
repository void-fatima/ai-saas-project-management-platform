import type { InputHTMLAttributes } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className = '', invalid = false, ...props }: InputProps) {
  const classes = ['input', invalid ? 'input--error' : '', className].filter(Boolean).join(' ');

  return <input aria-invalid={invalid || undefined} className={classes} {...props} />;
}
