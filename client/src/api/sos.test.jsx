import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMySos, useSosRequests } from './sos.js';
import { api } from './client.js';

vi.mock('./client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn() } };
});

function wrapper({ children }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('sos api hooks', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('useMySos reads from /sos/mine', async () => {
    api.get.mockResolvedValue({ data: { sos_requests: [{ id: 's1' }] } });
    const { result } = renderHook(() => useMySos(), { wrapper });
    await waitFor(() => expect(result.current.data).toEqual([{ id: 's1' }]));
    expect(api.get).toHaveBeenCalledWith('/sos/mine');
  });

  it('useSosRequests reads from /sos with params', async () => {
    api.get.mockResolvedValue({ data: { sos_requests: [] } });
    renderHook(() => useSosRequests({ camp_id: 'c1' }), { wrapper });
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/sos', { params: { camp_id: 'c1' } }));
  });
});
