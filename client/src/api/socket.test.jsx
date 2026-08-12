import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const handlers = {};
const mockSocket = {
  connect: vi.fn(),
  disconnect: vi.fn(),
  on: vi.fn((event, cb) => { handlers[event] = cb; }),
  off: vi.fn(),
};

vi.mock('socket.io-client', () => ({ io: () => mockSocket }));

describe('useLiveCampUpdates', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('connects on mount and invalidates the camps query when an occupancy event arrives', async () => {
    const { useLiveCampUpdates } = await import('./socket.js');
    const qc = new QueryClient();
    const invalidateSpy = vi.spyOn(qc, 'invalidateQueries');
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    renderHook(() => useLiveCampUpdates(), { wrapper });

    expect(mockSocket.connect).toHaveBeenCalled();
    handlers['camp:occupancy']({ campId: 'abc' });
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['camps'] });
  });

  it('disconnects on unmount', async () => {
    const { useLiveCampUpdates } = await import('./socket.js');
    const qc = new QueryClient();
    const wrapper = ({ children }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

    const { unmount } = renderHook(() => useLiveCampUpdates(), { wrapper });
    unmount();
    expect(mockSocket.disconnect).toHaveBeenCalled();
  });
});
