import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandingPage } from './LandingPage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

const campFixture = (over = {}) => ({
  id: '1', name: 'Riverside Community Hall', area: 'Ward 12', district: 'North District',
  beneficiary_capacity: 400, beneficiaries_accepted: 240,
  volunteer_capacity: 30, volunteers_accepted: 28,
  status: 'open', facilities: { food: true, drinking_water: true }, ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LandingPage /></MemoryRouter></QueryClientProvider>);
}

describe('LandingPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows the flood alert banner when active alerts exist', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [] } });
      if (url === '/alerts/active') return Promise.resolve({ data: { alerts: [{ area_name: 'Ward 12', message: 'Water rising fast.' }] } });
      return Promise.resolve({ data: {} });
    });
    renderPage();
    expect(await screen.findByText(/water rising fast/i)).toBeInTheDocument();
  });

  it('lists camps with a live occupancy figure', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [campFixture()] } });
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    expect(await screen.findByText('Riverside Community Hall')).toBeInTheDocument();
    expect(screen.getByText('240 / 400')).toBeInTheDocument();
  });

  it('disables the register button for a full camp', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') return Promise.resolve({ data: { camps: [campFixture({ status: 'full', beneficiaries_accepted: 400 })] } });
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    expect(await screen.findByRole('button', { name: /camp full/i })).toBeDisabled();
  });

  it('filters camps by search text', async () => {
    api.get.mockImplementation((url) => {
      if (url === '/camps') {
        return Promise.resolve({
          data: { camps: [campFixture(), campFixture({ id: '2', name: 'Central Auditorium', area: 'Ward 3' })] },
        });
      }
      return Promise.resolve({ data: { alerts: [] } });
    });
    renderPage();
    await screen.findByText('Riverside Community Hall');
    await userEvent.type(screen.getByPlaceholderText(/search camp or area/i), 'Auditorium');
    expect(screen.queryByText('Riverside Community Hall')).not.toBeInTheDocument();
    expect(screen.getByText('Central Auditorium')).toBeInTheDocument();
  });
});
