import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AccountRecoveryView } from './AccountRecoveryView';

describe('Account verification and recovery interface', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('shows generic forgot-password feedback without exposing API contents', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);
    render(<AccountRecoveryView action="forgot" onBack={vi.fn()} onSuccess={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'owner@example.com' } });
    fireEvent.submit(screen.getByRole('form'));
    expect(await screen.findByRole('status')).toHaveTextContent('If the account is eligible');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it('validates reset passwords and clears them after success without logging in', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const success = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    render(
      <AccountRecoveryView
        action="reset"
        token={'a'.repeat(43)}
        onBack={vi.fn()}
        onSuccess={success}
      />,
    );
    fireEvent.submit(screen.getByRole('form'));
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'new-password-42' },
    });
    fireEvent.submit(screen.getByRole('form'));
    await waitFor(() => expect(success).toHaveBeenCalledOnce());
    expect(screen.getByLabelText('New password')).toHaveValue('');
    expect(screen.getByRole('status')).toHaveTextContent('All devices are signed out');
  });
  it.each([400, 429, 503])('provides safe feedback for verification error %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('private details', { status })));
    render(
      <AccountRecoveryView action="verify" token="invalid" onBack={vi.fn()} onSuccess={vi.fn()} />,
    );
    fireEvent.submit(screen.getByRole('form'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      status === 400
        ? /invalid, expired, or already used/
        : status === 429
          ? /Too many/
          : /temporarily unavailable/,
    );
    expect(alert).not.toHaveTextContent('private details');
  });
});
