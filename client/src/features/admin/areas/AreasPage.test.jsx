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
      data: { areas: [{ id: '1', name: 'Ward 12', district: 'North District', state: 'Assam', severity: 'high' }] },
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
});
