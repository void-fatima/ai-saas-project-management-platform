import type { FormEvent, FormHTMLAttributes } from 'react';

export interface FormProps extends Omit<FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: () => void;
}

export function Form({ onSubmit, ...props }: FormProps) {
  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    onSubmit();
  }

  return <form onSubmit={handleSubmit} {...props} />;
}
