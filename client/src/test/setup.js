import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';

// Testing Library's 1s default for findBy/waitFor is separate from Vitest's
// testTimeout and is not raised by it. A page that mounts a provider, resolves
// two queries and settles an effect regularly takes ~600ms here, and more
// under full-suite contention — close enough to 1s to fail intermittently on
// timing alone rather than on anything being wrong.
configure({ asyncUtilTimeout: 5000 });

// jsdom has no ResizeObserver — Leaflet (AreasPage's map) uses one to size
// itself against its container. A no-op stub is enough for a test that
// never actually measures pixels.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
