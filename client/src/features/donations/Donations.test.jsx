import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DonorProfilePage } from './DonorProfilePage.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

// Wrapped in MemoryRouter, not just QueryClientProvider: Task 11's
// DonationEntryPage renders a react-router `Link` in its no-profile state,
// and a Link outside a Router throws. Wrapping every page here rather than
// only that one keeps this one helper usable by all three pages in this
// file, the same way DashboardPage.test.jsx already wraps for the same reason.
function renderPage(ui) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}

describe('DonorProfilePage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('starts blank when there is no profile yet', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    renderPage(<DonorProfilePage />);
    expect(await screen.findByLabelText(/^name$/i)).toHaveValue('');
  });

  it('pre-fills from an existing profile', async () => {
    api.get.mockResolvedValue({ data: { donor: { donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: '4 Lake View Road', contact_person: '', email: '', registration_details: '' } } });
    renderPage(<DonorProfilePage />);
    expect(await screen.findByLabelText(/^name$/i)).toHaveValue('Meera Iyer');
  });

  it('shows the NGO fields only when NGO is selected', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    const user = userEvent.setup();
    renderPage(<DonorProfilePage />);

    expect(screen.queryByLabelText(/contact person/i)).not.toBeInTheDocument();

    await user.click(await screen.findByRole('combobox', { name: /donor type/i }));
    await user.click(await screen.findByRole('option', { name: /ngo/i }));

    expect(await screen.findByLabelText(/contact person/i)).toBeInTheDocument();
  });

  it('saves and confirms', async () => {
    api.get.mockResolvedValue({ data: { donor: null } });
    api.post.mockResolvedValue({ data: { donor: { name: 'Meera Iyer' } } });
    const user = userEvent.setup();
    renderPage(<DonorProfilePage />);

    await user.type(await screen.findByLabelText(/^name$/i), 'Meera Iyer');
    await user.type(screen.getByLabelText(/mobile/i), '9876543210');
    await user.type(screen.getByLabelText(/address/i), '4 Lake View Road');
    await user.click(screen.getByRole('button', { name: /save profile/i }));

    expect(await screen.findByText(/profile saved/i)).toBeInTheDocument();
  });
});
