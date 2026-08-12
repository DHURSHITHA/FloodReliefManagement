import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampsListPage } from './CampsListPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CampsListPage /></MemoryRouter></QueryClientProvider>);
}

describe('CampsListPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists camps with occupancy and status', async () => {
    api.get.mockResolvedValue({
      data: { camps: [{
        id: '1', name: 'Riverside Community Hall', area: 'Ward 12', district: 'North District',
        camp_type: 'community_hall', beneficiary_capacity: 400, beneficiaries_accepted: 240,
        volunteer_capacity: 30, volunteers_accepted: 28, duration_days: 14,
        status: 'open', assigned_official_id: null,
      }] },
    });
    renderPage();
    expect(await screen.findByText('Riverside Community Hall')).toBeInTheDocument();
    expect(screen.getByText('240 / 400')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows an empty state with no camps', async () => {
    api.get.mockResolvedValue({ data: { camps: [] } });
    renderPage();
    expect(await screen.findByText(/no camps yet/i)).toBeInTheDocument();
  });
});
