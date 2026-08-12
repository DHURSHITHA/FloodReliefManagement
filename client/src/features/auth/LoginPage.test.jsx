import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './LoginPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><LoginPage /></MemoryRouter>
    </QueryClientProvider>
  );
}

describe('LoginPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the fields a user needs', () => {
    renderPage();
    expect(screen.getByLabelText(/mobile number or email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
  });

  it('validates before sending anything to the server', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/enter your mobile number or email/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits valid credentials', async () => {
    api.post.mockResolvedValue({ data: { access_token: 'tok', user: { id: '1', role: 'affected_person' } } });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/auth/login', {
        identifier: '9876543210', password: 'correct horse battery',
      })
    );
  });

  it('shows the server message when credentials are rejected', async () => {
    api.post.mockRejectedValue({
      response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', details: [] } } },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong password!!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/invalid credentials/i)).toBeInTheDocument();
  });

  it('explains a pending camp official account rather than showing a bare error', async () => {
    api.post.mockRejectedValue({
      response: { status: 403, data: { error: {
        code: 'ACCOUNT_PENDING_APPROVAL',
        message: 'Your camp official account is awaiting administrator approval.',
        details: [] } } },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/mobile number or email/i), '9876543212');
    await userEvent.type(screen.getByLabelText(/^password/i), 'correct horse battery');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    expect(await screen.findByText(/awaiting administrator approval/i)).toBeInTheDocument();
  });

  it('keeps what the user typed after a failed attempt', async () => {
    api.post.mockRejectedValue({
      response: { status: 401, data: { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials.', details: [] } } },
    });
    renderPage();
    const id = screen.getByLabelText(/mobile number or email/i);
    await userEvent.type(id, '9876543210');
    await userEvent.type(screen.getByLabelText(/^password/i), 'wrong password!!');
    await userEvent.click(screen.getByRole('button', { name: /sign in/i }));
    await screen.findByText(/invalid credentials/i);
    // Requirements §13: the UI must not silently lose entered data.
    expect(id).toHaveValue('9876543210');
  });
});
