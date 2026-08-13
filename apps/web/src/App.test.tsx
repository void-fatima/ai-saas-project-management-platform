import { render, screen, waitFor } from '@testing-library/react';
import { vi } from 'vitest';

import { App } from './App';

describe('App', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders the foundation shell and reports a healthy API', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));

    render(<App />);

    expect(screen.getByRole('heading', { name: 'Project Platform' })).toBeInTheDocument();
    expect(screen.getByText('API checking')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('API available')).toBeInTheDocument());
  });
});
