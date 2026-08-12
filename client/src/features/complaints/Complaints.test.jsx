import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RaiseComplaintPage } from './RaiseComplaintPage.jsx';
import { ComplaintsQueuePage } from './ComplaintsQueuePage.jsx';
import { CampScopeProvider } from '../../camps/CampScope.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});
vi.mock('../../AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { role: 'camp_official', assigned_camp_ids: ['c1'] } }),
}));

const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }];
const OPEN_COMPLAINT = {
  id: 'q1', complaint_code: 'CMP-1001', camp_id: 'c1', category: 'water',
  description: 'The water point has been dry since morning.', priority: 'high',
  status: 'open', resolution: '', createdAt: '2026-08-12T09:00:00.000Z',
};

function mockGet({ camps = CAMPS, mine = [], complaints = [], registration = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/complaints/mine') return Promise.resolve({ data: { complaints: mine } });
    if (url === '/complaints') return Promise.resolve({ data: { complaints } });
    if (url === '/registrations/me') return Promise.resolve({ data: { registration } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampScopeProvider>{ui}</CampScopeProvider>
    </QueryClientProvider>,
  );
}

describe('RaiseComplaintPage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('will not send until the description is substantial', async () => {
    mockGet();
    const user = userEvent.setup();
    renderPage(<RaiseComplaintPage />);

    await user.click(await screen.findByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: 'Riverside Hall' }));

    expect(screen.getByRole('button', { name: /send to the camp official/i })).toBeDisabled();

    await user.type(screen.getByLabelText(/describe the problem/i), 'The water point is dry.');
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send to the camp official/i })).toBeEnabled());
  });

  it('confirms with the complaint code once sent', async () => {
    mockGet();
    api.post.mockResolvedValue({ data: { complaint: { ...OPEN_COMPLAINT, complaint_code: 'CMP-1007' } } });
    const user = userEvent.setup();
    renderPage(<RaiseComplaintPage />);

    await user.click(await screen.findByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: 'Riverside Hall' }));
    await user.type(screen.getByLabelText(/describe the problem/i), 'The water point is dry.');
    await user.click(screen.getByRole('button', { name: /send to the camp official/i }));

    expect(await screen.findByText(/CMP-1007/)).toBeInTheDocument();
  });

  it('shows the reporter what came back', async () => {
    mockGet({ mine: [{ ...OPEN_COMPLAINT, status: 'resolved', resolution: 'Tanker refilled at 14:00.' }] });
    renderPage(<RaiseComplaintPage />);

    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Tanker refilled at 14:00.')).toBeInTheDocument();
  });
});

describe('ComplaintsQueuePage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('counts what still needs attention', async () => {
    mockGet({ complaints: [OPEN_COMPLAINT, { ...OPEN_COMPLAINT, id: 'q2', status: 'resolved' }] });
    renderPage(<ComplaintsQueuePage />);
    expect(await screen.findByText(/1 still need attention/i)).toBeInTheDocument();
  });

  it('asks what was done before letting one be closed', async () => {
    mockGet({ complaints: [OPEN_COMPLAINT] });
    const user = userEvent.setup();
    renderPage(<ComplaintsQueuePage />);

    await user.click(await screen.findByRole('combobox', { name: /^status$/i }));
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));

    expect(await screen.findByLabelText(/what was done/i)).toBeInTheDocument();
  });

  it('sends the new status through', async () => {
    mockGet({ complaints: [OPEN_COMPLAINT] });
    api.patch.mockResolvedValue({ data: { complaint: { ...OPEN_COMPLAINT, status: 'in_progress' } } });
    const user = userEvent.setup();
    renderPage(<ComplaintsQueuePage />);

    await user.click(await screen.findByRole('combobox', { name: /^status$/i }));
    await user.click(await screen.findByRole('option', { name: 'In progress' }));
    // The select's backdrop covers the buttons until it has finished closing.
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
    await user.click(screen.getByRole('button', { name: /update/i }));

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith(
      '/complaints/q1', { status: 'in_progress', resolution: undefined },
    ));
  });

  it('says so when the camp has had nothing raised', async () => {
    mockGet({ complaints: [] });
    renderPage(<ComplaintsQueuePage />);
    expect(await screen.findByText(/nothing has been raised/i)).toBeInTheDocument();
  });
});
