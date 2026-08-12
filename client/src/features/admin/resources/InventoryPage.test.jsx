import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { InventoryPage } from './InventoryPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});
vi.mock('socket.io-client', () => ({ io: () => ({ connect: vi.fn(), disconnect: vi.fn(), on: vi.fn(), off: vi.fn() }) }));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><InventoryPage /></QueryClientProvider>);
}

function mockApi(inventory) {
  api.get.mockImplementation((url) => {
    if (url === '/resources') return Promise.resolve({ data: { items: [{ id: 'i1', name: 'Rice', unit: 'kg' }] } });
    if (url === '/camps') return Promise.resolve({ data: { camps: [{ id: 'c1', name: 'Riverside Hall' }] } });
    return Promise.resolve({ data: { inventory } });
  });
}

describe('InventoryPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('flags an entry that is below its reorder threshold', async () => {
    mockApi([{
      id: '1', item_id: 'i1', camp_id: 'c1', remaining_qty: 10, distributed_qty: 0,
      reorder_threshold: 50, is_low_stock: true, is_near_expiry: false, is_expired: false,
    }]);
    renderPage();
    expect(await screen.findByText('Rice')).toBeInTheDocument();
    expect(screen.getByText(/low stock/i)).toBeInTheDocument();
  });

  it('shows an OK badge for healthy stock', async () => {
    mockApi([{
      id: '1', item_id: 'i1', camp_id: 'c1', remaining_qty: 400, distributed_qty: 10,
      reorder_threshold: 50, is_low_stock: false, is_near_expiry: false, is_expired: false,
    }]);
    renderPage();
    expect(await screen.findByText('OK')).toBeInTheDocument();
  });

  it('shows an empty state when nothing is stocked', async () => {
    mockApi([]);
    renderPage();
    expect(await screen.findByText(/no stock recorded yet/i)).toBeInTheDocument();
  });
});
