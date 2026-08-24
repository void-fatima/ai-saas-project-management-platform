import { useId, type InputHTMLAttributes } from 'react';

import { Input } from './Input';

export interface FormFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  hint?: string;
  label: string;
}

export function FormField({ className = '', error, hint, id, label, ...props }: FormFieldProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const descriptionId = hint || error ? `${inputId}-description` : undefined;

  return (
    <div className="form-field">
      <label className="form-field__label" htmlFor={inputId}>
        {label}
      </label>
      <Input
        aria-describedby={descriptionId}
        className={className}
        id={inputId}
        invalid={Boolean(error)}
        {...props}
      />
      {error ? (
        <p className="form-field__message form-field__message--error" id={descriptionId}>
          {error}
        </p>
      ) : hint ? (
        <p className="form-field__message" id={descriptionId}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}
