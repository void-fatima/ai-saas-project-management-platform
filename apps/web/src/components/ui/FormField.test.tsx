import { render, screen } from '@testing-library/react';

import { FormField } from './FormField';

describe('FormField', () => {
  it('associates its label and hint with the input', () => {
    render(<FormField hint="Use a work email" label="Email" type="email" />);

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAccessibleDescription('Use a work email');
    expect(input).not.toHaveAttribute('aria-invalid');
  });

  it('exposes validation errors accessibly', () => {
    render(<FormField error="Email is required" label="Email" />);

    const input = screen.getByRole('textbox', { name: 'Email' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Email is required');
  });
});
