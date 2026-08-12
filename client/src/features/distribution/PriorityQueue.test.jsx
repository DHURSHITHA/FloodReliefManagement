import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PriorityQueue } from './PriorityQueue.jsx';
import { CampScopeProvider } from '../../camps/CampScope.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});
vi.mock('../../AuthProvider.jsx', () => ({
  useAuth: () => ({ user: { role: 'camp_official', assigned_camp_ids: ['c1'] } }),
}));

// Returned already sorted by the server — the panel renders that order as-is.
const QUEUE = [
  { id: 'm1', name: 'Expecting Mother', age: 28, beneficiary_code: 'BEN-1001', priority_tags: ['pregnant'] },
  { id: 'm2', name: 'Grandfather', age: 71, beneficiary_code: 'BEN-1002', priority_tags: ['senior_citizen'] },
  { id: 'm3', name: 'Young Child', age: 8, beneficiary_code: 'BEN-1003', priority_tags: ['child'] },
];

function renderQueue({ members = QUEUE, onSelect = vi.fn() } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/camps') return Promise.resolve({ data: { camps: [{ id: 'c1', name: 'Riverside Hall' }] } });
    return Promise.resolve({ data: { members } });
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <CampScopeProvider><PriorityQueue onSelect={onSelect} /></CampScopeProvider>
    </QueryClientProvider>,
  );
  return { onSelect };
}

describe('PriorityQueue', () => {
  beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); });

  it('lists the queue in the order the server returned', async () => {
    renderQueue();
    await screen.findByText('Expecting Mother');
    const names = screen.getAllByText(/Expecting Mother|Grandfather|Young Child/).map((n) => n.textContent);
    expect(names).toEqual(['Expecting Mother', 'Grandfather', 'Young Child']);
  });

  it('labels why each person is prioritised', async () => {
    renderQueue();
    expect(await screen.findByText('Pregnant')).toBeInTheDocument();
    expect(screen.getByText('Senior citizen')).toBeInTheDocument();
    expect(screen.getByText('Child')).toBeInTheDocument();
  });

  it('hands the chosen person back so the form can be filled', async () => {
    const user = userEvent.setup();
    const { onSelect } = renderQueue();

    await user.click(await screen.findByText('Grandfather'));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ beneficiary_code: 'BEN-1002' }),
    ));
  });

  it('says so when nobody with a priority tag has checked in', async () => {
    renderQueue({ members: [] });
    expect(await screen.findByText(/nobody with a priority tag/i)).toBeInTheDocument();
  });
});
