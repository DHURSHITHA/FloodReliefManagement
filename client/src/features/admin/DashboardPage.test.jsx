import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardPage } from './DashboardPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

const summary = {
  camps: { total: 3, by_status: { open: 2, full: 1 }, beneficiary_capacity: 100, beneficiaries_accepted: 40 },
  beneficiaries: { total_registered: 40, total_checked_in: 25, high_priority: 6 },
  volunteers: { accepted: 5, active: 2, completed: 1 },
  inventory: { total_entries: 8, low_stock: 2, near_expiry: 1, expired: 0 },
  flood_monitoring: { affected_areas: 4, active_alerts: 1 },
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><DashboardPage /></MemoryRouter></QueryClientProvider>);
}

describe('DashboardPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows registered and checked-in as separate figures', async () => {
    api.get.mockResolvedValue({ data: summary });
    renderPage();
    expect(await screen.findByText('Households registered')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('People checked in')).toBeInTheDocument();
    expect(screen.getByText('25')).toBeInTheDocument();
  });

  it('renders every M1 dashboard area', async () => {
    api.get.mockResolvedValue({ data: summary });
    renderPage();
    expect(await screen.findByText('Camps')).toBeInTheDocument();
    expect(screen.getByText('Beneficiaries')).toBeInTheDocument();
    expect(screen.getByText('Volunteers')).toBeInTheDocument();
    expect(screen.getByText('Inventory')).toBeInTheDocument();
    expect(screen.getByText('Flood monitoring')).toBeInTheDocument();
  });

  it('shows occupied beds as a ratio', async () => {
    api.get.mockResolvedValue({ data: summary });
    renderPage();
    expect(await screen.findByText('40 / 100')).toBeInTheDocument();
  });
});
