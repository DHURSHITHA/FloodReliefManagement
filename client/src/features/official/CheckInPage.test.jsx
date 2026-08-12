import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CheckInPage } from './CheckInPage.jsx';
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
      <CampScopeProvider><CheckInPage /></CampScopeProvider>
    </QueryClientProvider>,
  );
}

describe('CheckInPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('searches and lists matching members with a check-in button', async () => {
    api.get.mockResolvedValue({
      data: {
        registrations: [{
          beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'applied' },
          members: [
            { id: 'm1', name: 'Meena Devi', checkin_status: 'pending' },
            { id: 'm2', name: 'Raju', checkin_status: 'pending' },
          ],
        }],
      },
    });
    renderPage();
    await userEvent.type(screen.getByLabelText(/search by code, name, or mobile/i), 'Meena');
    expect(await screen.findByText('BEN-1001')).toBeInTheDocument();
    expect(screen.getByText('Meena Devi')).toBeInTheDocument();
    expect(screen.getByText('Raju')).toBeInTheDocument();
  });

  it('checks in a member on click', async () => {
    api.get.mockResolvedValue({
      data: {
        registrations: [{
          beneficiary: { id: 'b1', beneficiary_code: 'BEN-1001', status: 'applied' },
          members: [{ id: 'm1', name: 'Meena Devi', checkin_status: 'pending' }],
        }],
      },
    });
    api.post.mockResolvedValue({ data: { member: { id: 'm1', checkin_status: 'checked_in' } } });
    renderPage();
    await userEvent.type(screen.getByLabelText(/search by code, name, or mobile/i), 'Meena');
    await screen.findByText('Meena Devi');

    await userEvent.click(screen.getByRole('button', { name: /check in/i }));
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/registrations/b1/members/m1/checkin'));
  });
});
