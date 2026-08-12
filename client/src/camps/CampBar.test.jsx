import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CampBar } from './CampBar.jsx';
import { CampScopeProvider, useCampScope } from './CampScope.jsx';
import { api } from '../api/client.js';

vi.mock('../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

let mockUser = null;
vi.mock('../AuthProvider.jsx', () => ({ useAuth: () => ({ user: mockUser }) }));

const CAMPS = [
  { id: 'c1', name: 'Riverside Hall' },
  { id: 'c2', name: 'Hilltop School' },
  { id: 'c3', name: 'Someone Elses Camp' },
];

/** Surfaces what the pages would actually send to the API. */
function ScopeProbe() {
  const { params } = useCampScope();
  return <div data-testid="params">{JSON.stringify(params)}</div>;
}

function renderBar() {
  api.get.mockResolvedValue({ data: { camps: CAMPS } });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <CampScopeProvider><CampBar /><ScopeProbe /></CampScopeProvider>
    </QueryClientProvider>,
  );
}

describe('CampBar', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); mockUser = null; });

  it('offers an official only the camps assigned to them', async () => {
    mockUser = { role: 'camp_official', assigned_camp_ids: ['c1', 'c2'] };
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('combobox', { name: /camp/i }));
    expect(await screen.findByRole('option', { name: 'Riverside Hall' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hilltop School' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Someone Elses Camp' })).not.toBeInTheDocument();
  });

  it('gives an official with one camp no choice to make', async () => {
    mockUser = { role: 'camp_official', assigned_camp_ids: ['c2'] };
    renderBar();
    await waitFor(() =>
      expect(screen.getByTestId('params')).toHaveTextContent('{"camp_id":"c2"}'));
  });

  it('sends the chosen camp as a query param', async () => {
    mockUser = { role: 'camp_official', assigned_camp_ids: ['c1', 'c2'] };
    const user = userEvent.setup();
    renderBar();

    await user.click(await screen.findByRole('combobox', { name: /camp/i }));
    await user.click(await screen.findByRole('option', { name: 'Hilltop School' }));

    await waitFor(() =>
      expect(screen.getByTestId('params')).toHaveTextContent('{"camp_id":"c2"}'));
  });

  it('lets an admin work across every camp', async () => {
    mockUser = { role: 'admin', assigned_camp_ids: [] };
    renderBar();

    expect(await screen.findByRole('combobox', { name: /camp/i })).toBeInTheDocument();
    // No selection means no camp_id param, so nothing is narrowed.
    expect(screen.getByTestId('params')).toHaveTextContent('{}');
  });

  it('tells an official with no camps why there is nobody to find', async () => {
    mockUser = { role: 'camp_official', assigned_camp_ids: [] };
    renderBar();
    expect(await screen.findByText(/no camp is assigned to your account/i)).toBeInTheDocument();
  });

  it('drops a stored camp the official is no longer assigned to', async () => {
    localStorage.setItem('frp.selectedCampId', 'c3');
    mockUser = { role: 'camp_official', assigned_camp_ids: ['c1', 'c2'] };
    renderBar();

    await waitFor(() => expect(screen.getByTestId('params')).toHaveTextContent('{}'));
    expect(localStorage.getItem('frp.selectedCampId')).toBeNull();
  });
});
