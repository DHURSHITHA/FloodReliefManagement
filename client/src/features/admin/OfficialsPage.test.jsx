import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfficialsPage } from './OfficialsPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OfficialsPage /></QueryClientProvider>);
}

function mockApi({ officials = [], camps = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    return Promise.resolve({ data: { officials } });
  });
}

const PENDING = [{
  id: 'u1', name: 'Ravi Official', mobile: '9876543212',
  status: 'pending_approval', createdAt: '2026-08-12T09:00:00.000Z',
}];
const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }];

describe('OfficialsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists officials waiting for approval', async () => {
    mockApi({ officials: PENDING, camps: CAMPS });
    renderPage();
    expect(await screen.findByText('Ravi Official')).toBeInTheDocument();
  });

  it('cannot approve until a camp is chosen', async () => {
    mockApi({ officials: PENDING, camps: CAMPS });
    renderPage();
    expect(await screen.findByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('approves with the chosen camp', async () => {
    mockApi({ officials: PENDING, camps: CAMPS });
    api.post.mockResolvedValue({ data: { user: { id: 'u1', status: 'active' } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: /camps they will run/i }));
    await user.click(await screen.findByRole('option', { name: 'Riverside Hall' }));
    await user.keyboard('{Escape}'); // a multi-select stays open; its backdrop covers the buttons
    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/officials/u1/decision',
      { decision: 'approve', assigned_camp_ids: ['c1'] },
    ));
  });

  it('rejects without needing a camp', async () => {
    mockApi({ officials: PENDING, camps: CAMPS });
    api.post.mockResolvedValue({ data: { user: { id: 'u1', status: 'rejected' } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /reject/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/officials/u1/decision',
      { decision: 'reject', assigned_camp_ids: [] },
    ));
  });

  it('warns when there is no camp to assign', async () => {
    mockApi({ officials: PENDING, camps: [] });
    renderPage();
    expect(await screen.findByText(/create a camp before approving/i)).toBeInTheDocument();
  });

  it('shows an empty state when nobody is waiting', async () => {
    mockApi({ officials: [], camps: CAMPS });
    renderPage();
    expect(await screen.findByText(/no officials are waiting/i)).toBeInTheDocument();
  });
});
