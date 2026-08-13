import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AreasPage } from './AreasPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><AreasPage /></QueryClientProvider>);
}

describe('AreasPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('lists existing areas', async () => {
    api.get.mockResolvedValue({
      data: { areas: [{ id: '1', name: 'Ward 12', district: 'North District', state: 'Assam', severity: 'high', latitude: 26.2, longitude: 91.7, has_camp: false }] },
    });
    renderPage();
    expect(await screen.findByText('Ward 12')).toBeInTheDocument();
  });

  it('submits a new area', async () => {
    api.get.mockResolvedValue({ data: { areas: [] } });
    api.post.mockResolvedValue({ data: { area: { id: '2', name: 'Ward 5' } } });
    renderPage();
    await screen.findByText(/no affected areas recorded yet/i);

    await userEvent.type(screen.getByLabelText(/area name/i), 'Ward 5');
    await userEvent.type(screen.getByLabelText(/district/i), 'East District');
    await userEvent.type(screen.getByLabelText(/^state/i), 'Assam');
    await userEvent.type(screen.getByLabelText(/address/i), 'Near canal');
    await userEvent.type(screen.getByLabelText(/latitude/i), '26.1');
    await userEvent.type(screen.getByLabelText(/longitude/i), '91.6');
    await userEvent.click(screen.getByRole('button', { name: /record area/i }));

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/areas', expect.objectContaining({ name: 'Ward 5' })));
  });

  const TWO_AREAS = [
    { id: '1', name: 'Ward 12', district: 'North District', state: 'Assam', severity: 'high', latitude: 26.2, longitude: 91.7, has_camp: true },
    { id: '2', name: 'Ward 5', district: 'East District', state: 'Assam', severity: 'low', latitude: 26.3, longitude: 91.8, has_camp: false },
  ];

  it('plots one dot on the map per area', async () => {
    api.get.mockResolvedValue({ data: { areas: TWO_AREAS } });
    renderPage();
    await screen.findByText('Ward 12');
    await waitFor(() => expect(document.querySelectorAll('.leaflet-interactive')).toHaveLength(2));
  });

  it('filters the map dots by whether a camp has been created there', async () => {
    api.get.mockResolvedValue({ data: { areas: TWO_AREAS } });
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Ward 12');
    await waitFor(() => expect(document.querySelectorAll('.leaflet-interactive')).toHaveLength(2));

    await user.click(screen.getByRole('button', { name: /^camp created$/i }));
    await waitFor(() => expect(document.querySelectorAll('.leaflet-interactive')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /^no camp yet$/i }));
    await waitFor(() => expect(document.querySelectorAll('.leaflet-interactive')).toHaveLength(1));

    await user.click(screen.getByRole('button', { name: /^all areas$/i }));
    await waitFor(() => expect(document.querySelectorAll('.leaflet-interactive')).toHaveLength(2));
  });
});
