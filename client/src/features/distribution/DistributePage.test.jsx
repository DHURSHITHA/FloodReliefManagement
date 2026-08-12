import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributePage } from './DistributePage.jsx';
import { CampScopeProvider } from '../../camps/CampScope.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});
// The page reads its camp from the shared scope, so the provider comes with it.
vi.mock('../../AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { role: 'camp_official', assigned_camp_ids: ['c1'] } }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampScopeProvider><DistributePage /></CampScopeProvider>
    </QueryClientProvider>,
  );
}

function mockLookup({ checkedIn = true } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/resources') return Promise.resolve({ data: { items: [{ id: 'i1', name: 'Rice', unit: 'kg' }] } });
    if (url.startsWith('/registrations/')) {
      return Promise.resolve({
        data: {
          registration: {
            beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'active' },
            members: [{ id: 'm1', name: 'Meena', checkin_status: checkedIn ? 'checked_in' : 'pending' }],
          },
        },
      });
    }
    return Promise.resolve({ data: {} });
  });
}

async function lookupAndPickItem() {
  await userEvent.type(screen.getByLabelText(/beneficiary code/i), 'BEN-1001');
  await userEvent.click(screen.getByRole('button', { name: /find/i }));
  await screen.findByText('BEN-1001');
  await userEvent.click(screen.getByLabelText(/item/i));
  await userEvent.click(await screen.findByRole('option', { name: 'Rice' }));
}

describe('DistributePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('looks up a beneficiary and records a distribution', async () => {
    mockLookup();
    api.post.mockResolvedValue({ data: { distribution: { id: 'd1', quantity: 5 } } });
    renderPage();
    await lookupAndPickItem();
    await userEvent.click(screen.getByRole('button', { name: /^distribute$/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/distributions', { beneficiary_id: 'b1', item_id: 'i1' })
    );
    expect(await screen.findByText(/distributed 5 unit/i)).toBeInTheDocument();
  }, 20000);

  it('surfaces a same-day duplicate as an error from the server', async () => {
    mockLookup();
    api.post.mockRejectedValue({
      response: { data: { error: { code: 'ALREADY_DISTRIBUTED', message: 'Already distributed for this period.' } } },
    });
    renderPage();
    await lookupAndPickItem();
    await userEvent.click(screen.getByRole('button', { name: /^distribute$/i }));

    expect(await screen.findByText(/already distributed for this period/i)).toBeInTheDocument();
  }, 20000);

  it('asks for an override reason when the beneficiary is unverified', async () => {
    mockLookup({ checkedIn: false });
    api.post.mockRejectedValue({
      response: {
        data: {
          error: {
            code: 'NOT_VERIFIED',
            message: 'This beneficiary has no checked-in members. Provide an override reason to distribute anyway.',
          },
        },
      },
    });
    renderPage();
    await lookupAndPickItem();
    await userEvent.click(screen.getByRole('button', { name: /^distribute$/i }));

    expect(await screen.findByLabelText(/override reason/i)).toBeInTheDocument();
  }, 20000);
});
