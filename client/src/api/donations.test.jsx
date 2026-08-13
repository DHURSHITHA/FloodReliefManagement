import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMyDonorProfile, useMyDonations, useAdminDonations } from './donations.js';
import { api } from './client.js';

vi.mock('./client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('donations api hooks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('useMyDonorProfile reads from /donors/me', async () => {
    api.get.mockResolvedValue({ data: { donor: { id: 'd1' } } });
    const { result } = renderHook(() => useMyDonorProfile(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual({ id: 'd1' }));
    expect(api.get).toHaveBeenCalledWith('/donors/me');
  });

  it('useMyDonations reads from /donations/mine', async () => {
    api.get.mockResolvedValue({ data: { donations: [] } });
    renderHook(() => useMyDonations(), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/donations/mine'));
  });

  it('useAdminDonations reads from /donations with params', async () => {
    api.get.mockResolvedValue({ data: { donations: [] } });
    renderHook(() => useAdminDonations({ status: 'pending' }), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/donations', { params: { status: 'pending' } }));
  });
});
