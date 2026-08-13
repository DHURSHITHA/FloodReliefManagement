import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DistributionRulesPage } from './DistributionRulesPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn(), patch: vi.fn() } };
});

const ITEM_ID = '64b64b64b64b64b64b64b01';
const CAMP_A_ID = '64b64b64b64b64b64b64b02';
const CAMP_B_ID = '64b64b64b64b64b64b64b03';
const RULE_ID = '64b64b64b64b64b64b64b04';

const ITEMS = [{ id: ITEM_ID, name: 'Rice', category: 'food', unit: 'kg' }];
const CAMPS = [{ id: CAMP_A_ID, name: 'Riverside Hall' }, { id: CAMP_B_ID, name: 'Hilltop School' }];

function mockGet({ rules = [] } = {}) {
  api.get.mockImplementation((url) => {
    if (url === '/resources') return Promise.resolve({ data: { items: ITEMS } });
    if (url === '/camps') return Promise.resolve({ data: { camps: CAMPS } });
    if (url === '/distribution-rules') return Promise.resolve({ data: { rules } });
    return Promise.resolve({ data: {} });
  });
}

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><DistributionRulesPage /></QueryClientProvider>);
}

async function pickItem(user) {
  await user.click(await screen.findByRole('combobox', { name: /^item$/i }));
  await user.click(await screen.findByRole('option', { name: /rice/i }));
}

describe('DistributionRulesPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('shows a camp-specific rule with the camp’s own name, and a global rule as the default', async () => {
    mockGet({
      rules: [
        { id: RULE_ID, item_id: ITEM_ID, camp_id: CAMP_A_ID, mode: 'fixed', period: 'daily', fixed_qty: 9, bands: [], active: true },
        { id: 'r2', item_id: ITEM_ID, camp_id: null, mode: 'fixed', period: 'daily', fixed_qty: 5, bands: [], active: true },
      ],
    });
    const user = userEvent.setup();
    renderPage();
    await pickItem(user);

    expect(await screen.findByText(/camp-specific override — riverside hall/i)).toBeInTheDocument();
    expect(await screen.findByText(/global default/i)).toBeInTheDocument();
  });

  it('creates a camp-specific rule for the selected camp', async () => {
    mockGet();
    api.post.mockResolvedValue({ data: { rule: { id: RULE_ID } } });
    const user = userEvent.setup();
    renderPage();
    await pickItem(user);

    await user.click(await screen.findByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: /riverside hall/i }));
    await user.type(screen.getByLabelText(/fixed quantity/i), '9');
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/distribution-rules', expect.objectContaining({ item_id: ITEM_ID, camp_id: CAMP_A_ID, fixed_qty: 9 }))
    );
  });

  it('creates a global rule when no camp is picked', async () => {
    mockGet();
    api.post.mockResolvedValue({ data: { rule: { id: RULE_ID } } });
    const user = userEvent.setup();
    renderPage();
    await pickItem(user);

    await user.type(screen.getByLabelText(/fixed quantity/i), '5');
    await user.click(screen.getByRole('button', { name: /save rule/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/distribution-rules', expect.objectContaining({ item_id: ITEM_ID, camp_id: null }))
    );
  });

  it('lets an admin edit an existing rule’s quantity', async () => {
    mockGet({
      rules: [{ id: RULE_ID, item_id: ITEM_ID, camp_id: CAMP_A_ID, mode: 'fixed', period: 'daily', fixed_qty: 9, bands: [], active: true }],
    });
    api.patch.mockResolvedValue({ data: { rule: { id: RULE_ID } } });
    const user = userEvent.setup();
    renderPage();
    await pickItem(user);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));
    const qtyField = screen.getByLabelText(/fixed quantity/i);
    expect(qtyField).toHaveValue('9');
    await user.clear(qtyField);
    await user.type(qtyField, '15');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/distribution-rules/${RULE_ID}`, expect.objectContaining({ fixed_qty: 15 }))
    );
  });

  it('clears a rule back to global when Edit → Global is chosen and saved', async () => {
    mockGet({
      rules: [{ id: RULE_ID, item_id: ITEM_ID, camp_id: CAMP_A_ID, mode: 'fixed', period: 'daily', fixed_qty: 9, bands: [], active: true }],
    });
    api.patch.mockResolvedValue({ data: { rule: { id: RULE_ID } } });
    const user = userEvent.setup();
    renderPage();
    await pickItem(user);

    await user.click(await screen.findByRole('button', { name: /^edit$/i }));
    await user.click(screen.getByRole('combobox', { name: /^camp$/i }));
    await user.click(await screen.findByRole('option', { name: /^global/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() =>
      expect(api.patch).toHaveBeenCalledWith(`/distribution-rules/${RULE_ID}`, expect.objectContaining({ camp_id: null }))
    );
  });
});
