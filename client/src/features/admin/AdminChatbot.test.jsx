import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminChatbot } from './AdminChatbot.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

const summary = {
  camps: { total: 3, by_status: { open: 2, full: 1 }, beneficiary_capacity: 100, beneficiaries_accepted: 40 },
  beneficiaries: { total_registered: 40, total_checked_in: 25, high_priority: 6 },
  volunteers: { accepted: 5, active: 2, completed: 1 },
  inventory: { total_entries: 8, low_stock: 2, near_expiry: 1, expired: 0 },
  flood_monitoring: { affected_areas: 4, active_alerts: 1 },
  emergency: { open: 2, medical: 1, security: 1, resolved: 3 },
};

const camps = [
  { id: 'c1', name: 'Riverside Camp', status: 'open' },
  { id: 'c2', name: 'Hilltop Camp', status: 'open' },
  { id: 'c3', name: 'Marsh Camp', status: 'full' },
];

const officials = [
  { id: 'o1', name: 'Anita Rao', status: 'active', assigned_camp_ids: ['c1'] },
  { id: 'o2', name: 'Vikram Shah', status: 'active', assigned_camp_ids: ['c2', 'c3'] },
];

function mockEndpoints() {
  api.get.mockImplementation((url) => {
    if (url === '/dashboard/summary') return Promise.resolve({ data: summary });
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/auth/officials') return Promise.resolve({ data: { officials } });
    return Promise.reject(new Error(`unexpected GET ${url}`));
  });
}

function renderChatbot() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AdminChatbot />
    </QueryClientProvider>
  );
}

describe('AdminChatbot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEndpoints();
  });

  it('stays closed until the floating button is clicked', async () => {
    const user = userEvent.setup();
    renderChatbot();

    expect(screen.queryByText('How many camps are there?')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open assistant/i }));

    expect(await screen.findByText('How many camps are there?')).toBeInTheDocument();
  });

  it('answers the camp count from live dashboard data, not a hardcoded number', async () => {
    const user = userEvent.setup();
    renderChatbot();
    await user.click(screen.getByRole('button', { name: /open assistant/i }));

    await user.click(await screen.findByText('How many camps are there?'));

    // 3 total / 2 open / 1 full comes from the mocked summary above; a
    // hardcoded answer could not produce these numbers.
    expect(await screen.findByText(/There are 3 camps/i)).toBeInTheDocument();
    expect(screen.getByText(/2 open/i)).toBeInTheDocument();
  });

  it('names the official running each camp', async () => {
    const user = userEvent.setup();
    renderChatbot();
    await user.click(screen.getByRole('button', { name: /open assistant/i }));

    await user.click(await screen.findByText('Who is the official for each camp?'));

    expect(await screen.findByText(/Riverside Camp/)).toBeInTheDocument();
    expect(screen.getByText(/Anita Rao/)).toBeInTheDocument();
    expect(screen.getByText(/Vikram Shah/)).toBeInTheDocument();
  });

  it('thinks, then deflects, when asked something off the list', async () => {
    const user = userEvent.setup();
    renderChatbot();
    await user.click(screen.getByRole('button', { name: /open assistant/i }));

    await user.type(
      await screen.findByRole('textbox', { name: /message/i }),
      'what is the weather tomorrow{Enter}'
    );

    expect(await screen.findByText(/let me think/i)).toBeInTheDocument();
    expect(await screen.findByText(/deeper look at the records/i)).toBeInTheDocument();
  });
});
