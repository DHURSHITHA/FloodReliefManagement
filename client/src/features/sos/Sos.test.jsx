import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RaiseSosPage } from './RaiseSosPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }];
const OPEN_SOS = {
  id: 's1', sos_code: 'SOS-1001', camp_id: 'c1', category: 'medical', urgency: 'critical',
  description: 'Chest pains, needs help now.', location: 'Tent 4', status: 'open',
  routed_to_type: 'hospital', routed_to_name: 'District Hospital', routed_to_contact: '0484-2000000',
  resolution: '', createdAt: '2026-08-13T09:00:00.000Z',
};

function mockGet({ camps = CAMPS, mine = [], registration = null } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/sos/mine') return Promise.resolve({ data: { sos_requests: mine } });
    if (url === '/registrations/me') return Promise.resolve({ data: { registration } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

describe('RaiseSosPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('will not send until the camp, location, and description are filled in', async () => {
    mockGet();
    const user = userEvent.setup();
    renderPage(<RaiseSosPage />);

    expect(await screen.findByRole('button', { name: /send emergency alert/i })).toBeDisabled();

    await user.click(screen.getByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: 'Riverside Hall' }));
    await user.type(screen.getByLabelText(/^where$/i), 'Tent 4');
    await user.type(screen.getByLabelText(/describe the emergency/i), 'Chest pains, needs help now.');

    await waitFor(() =>
      expect(screen.getByRole('button', { name: /send emergency alert/i })).toBeEnabled());
  });

  it('confirms with the routed contact once sent', async () => {
    mockGet();
    api.post.mockResolvedValue({ data: { sos: { ...OPEN_SOS } } });
    const user = userEvent.setup();
    renderPage(<RaiseSosPage />);

    await user.click(await screen.findByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: 'Riverside Hall' }));
    await user.type(screen.getByLabelText(/^where$/i), 'Tent 4');
    await user.type(screen.getByLabelText(/describe the emergency/i), 'Chest pains, needs help now.');
    await user.click(screen.getByRole('button', { name: /send emergency alert/i }));

    expect(await screen.findByText(/District Hospital/)).toBeInTheDocument();
  });

  it('shows the reporter their own report and what happened to it', async () => {
    mockGet({ mine: [{ ...OPEN_SOS, status: 'resolved', resolution: 'Taken to the medical tent, stable.' }] });
    renderPage(<RaiseSosPage />);

    expect(await screen.findByText('Resolved')).toBeInTheDocument();
    expect(screen.getByText('Taken to the medical tent, stable.')).toBeInTheDocument();
  });
});

import { SosDashboardPage } from './SosDashboardPage.jsx';
import { CampScopeProvider } from '../../camps/CampScope.jsx';

vi.mock('../../AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { role: 'camp_official', assigned_camp_ids: ['c1'] } }),
}));
vi.mock('../../api/socket.js', async (orig) => {
  const actual = await orig();
  return { ...actual, useLiveSosUpdates: vi.fn() };
});

function renderScoped(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampScopeProvider>{ui}</CampScopeProvider>
    </QueryClientProvider>,
  );
}

describe('SosDashboardPage', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('counts what still needs a response', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: CAMPS } });
      if (url === '/sos') return Promise.resolve({
        data: { sos_requests: [OPEN_SOS, { ...OPEN_SOS, id: 's2', status: 'resolved' }] },
      });
      return Promise.resolve({ data: {} });
    });
    renderScoped(<SosDashboardPage />);
    expect(await screen.findByText(/1 still need a response/i)).toBeInTheDocument();
  });

  it('asks what was done before letting one be resolved', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: CAMPS } });
      if (url === '/sos') return Promise.resolve({ data: { sos_requests: [OPEN_SOS] } });
      return Promise.resolve({ data: {} });
    });
    const user = userEvent.setup();
    renderScoped(<SosDashboardPage />);

    await user.click(await screen.findByRole('combobox', { name: /^status$/i }));
    await user.click(await screen.findByRole('option', { name: 'Resolved' }));

    expect(await screen.findByLabelText(/what was done/i)).toBeInTheDocument();
  });

  it('says so when nothing has been reported', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: CAMPS } });
      if (url === '/sos') return Promise.resolve({ data: { sos_requests: [] } });
      return Promise.resolve({ data: {} });
    });
    renderScoped(<SosDashboardPage />);
    expect(await screen.findByText(/nothing has been reported/i)).toBeInTheDocument();
  });
});
