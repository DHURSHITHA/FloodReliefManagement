import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OfficialsPage } from './OfficialsPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><OfficialsPage /></QueryClientProvider>);
}

function mockApi({ officials = [], camps = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/auth/officials') return Promise.resolve({ data: { officials } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

const PENDING = {
  id: 'u1', name: 'Ravi Official', mobile: '9876543212', email: null,
  status: 'pending_approval', assigned_camp_ids: [], createdAt: '2026-08-12T09:00:00.000Z',
};
const ACTIVE = {
  id: 'u2', name: 'Meena Official', mobile: '9876543213', email: null,
  status: 'active', assigned_camp_ids: ['c1'], createdAt: '2026-08-10T09:00:00.000Z',
};
const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }, { id: 'c2', name: 'Hilltop School' }];

describe('OfficialsPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists every official, pending and active alike', async () => {
    mockApi({ officials: [PENDING, ACTIVE], camps: CAMPS });
    renderPage();
    expect(await screen.findByText('Ravi Official')).toBeInTheDocument();
    expect(await screen.findByText('Meena Official')).toBeInTheDocument();
  });

  it('shows an active official their allotted camps as chips', async () => {
    mockApi({ officials: [ACTIVE], camps: CAMPS });
    renderPage();
    expect(await screen.findByText('Riverside Hall')).toBeInTheDocument();
  });

  it('cannot approve a pending official until a camp is chosen', async () => {
    mockApi({ officials: [PENDING], camps: CAMPS });
    renderPage();
    expect(await screen.findByRole('button', { name: /approve/i })).toBeDisabled();
  });

  it('approves a pending official with the chosen camp', async () => {
    mockApi({ officials: [PENDING], camps: CAMPS });
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

  it('rejects a pending official without needing a camp', async () => {
    mockApi({ officials: [PENDING], camps: CAMPS });
    api.post.mockResolvedValue({ data: { user: { id: 'u1', status: 'rejected' } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /reject/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/auth/officials/u1/decision',
      { decision: 'reject', assigned_camp_ids: [] },
    ));
  });

  it('adds a camp to an active official by clicking the + icon', async () => {
    mockApi({ officials: [ACTIVE], camps: CAMPS });
    api.patch.mockResolvedValue({ data: { user: { id: 'u2', status: 'active', assigned_camp_ids: ['c1', 'c2'] } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add a camp for meena official/i }));
    const combo = await screen.findByRole('combobox', { name: /add camps/i });
    await user.click(combo);
    await user.click(await screen.findByRole('option', { name: 'Hilltop School' }));
    await user.keyboard('{Escape}');
    await user.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/auth/officials/u2/camps',
      { camp_ids: ['c2'] },
    ));
  });

  it('only offers camps the official does not already run', async () => {
    mockApi({ officials: [ACTIVE], camps: CAMPS });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: /add a camp for meena official/i }));
    const combo = await screen.findByRole('combobox', { name: /add camps/i });
    await user.click(combo);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).queryByRole('option', { name: 'Riverside Hall' })).not.toBeInTheDocument();
    expect(within(listbox).getByRole('option', { name: 'Hilltop School' })).toBeInTheDocument();
  });

  it('warns when there is no camp to assign', async () => {
    mockApi({ officials: [PENDING], camps: [] });
    renderPage();
    expect(await screen.findByText(/create a camp before approving/i)).toBeInTheDocument();
  });

  it('shows an empty state when nobody has signed up', async () => {
    mockApi({ officials: [], camps: CAMPS });
    renderPage();
    expect(await screen.findByText(/no camp officials have signed up/i)).toBeInTheDocument();
  });
});
