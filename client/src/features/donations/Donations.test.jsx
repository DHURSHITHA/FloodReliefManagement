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

import { DonationEntryPage } from './DonationEntryPage.jsx';

const CAMPS = [{ id: 'c1', name: 'Riverside Hall' }];
const ITEMS = [{ id: 'i1', name: 'Rice', category: 'food', unit: 'kg' }];
const DONOR = { donor_type: 'individual', name: 'Meera Iyer', mobile: '9876543210', address: 'Addr', contact_person: '', email: '', registration_details: '' };

function mockEntryGet({ donor = DONOR, camps = CAMPS, items = ITEMS, mine = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/donors/me') return Promise.resolve({ data: { donor } });
    if (url === '/camps') return Promise.resolve({ data: { camps } });
    if (url === '/resources') return Promise.resolve({ data: { items } });
    if (url === '/donations/mine') return Promise.resolve({ data: { donations: mine } });
    return Promise.resolve({ data: {} });
  });
}

describe('DonationEntryPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('prompts for a profile first when none exists', async () => {
    mockEntryGet({ donor: null });
    renderPage(<DonationEntryPage />);
    expect(await screen.findByText(/create your donor profile/i)).toBeInTheDocument();
  });

  it('records a financial donation and confirms with the code', async () => {
    mockEntryGet();
    api.post.mockResolvedValue({ data: { donation: { donation_code: 'DON-1007' } } });
    const user = userEvent.setup();
    renderPage(<DonationEntryPage />);

    await user.type(await screen.findByLabelText(/amount/i), '5000');
    await user.type(screen.getByLabelText(/how was this paid/i), 'UPI');
    await user.click(screen.getByRole('button', { name: /record donation/i }));

    expect(await screen.findByText(/DON-1007/)).toBeInTheDocument();
  });

  it('switches to material fields and lets an item be added', async () => {
    mockEntryGet();
    const user = userEvent.setup();
    renderPage(<DonationEntryPage />);

    await user.click(await screen.findByRole('combobox', { name: /^type$/i }));
    await user.click(await screen.findByRole('option', { name: /material/i }));

    expect(await screen.findByRole('combobox', { name: /item/i })).toBeInTheDocument();
    expect(screen.queryByLabelText(/^amount$/i)).not.toBeInTheDocument();
  });

  it('shows the donor their own donation history', async () => {
    mockEntryGet({ mine: [{ id: 'd1', donation_code: 'DON-1001', donation_type: 'financial', amount: 1000, status: 'confirmed', materials: [], createdAt: '2026-08-13T00:00:00.000Z' }] });
    renderPage(<DonationEntryPage />);
    expect(await screen.findByText('DON-1001')).toBeInTheDocument();
  });
});
