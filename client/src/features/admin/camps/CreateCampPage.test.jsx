import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateCampPage } from './CreateCampPage.jsx';
import { api } from '../../../api/client.js';

vi.mock('../../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, get: vi.fn(), post: vi.fn() } };
});

const AREAS = [{ id: '64b64b64b64b64b64b64b64b', name: 'Ward 12', district: 'North District', state: 'Assam', address: 'Near river embankment', latitude: 26.2, longitude: 91.7, severity: 'high', has_camp: false }];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><CreateCampPage /></MemoryRouter></QueryClientProvider>);
}

describe('CreateCampPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.get.mockResolvedValue({ data: { areas: AREAS } });
  });

  it('validates before sending anything to the server', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('button', { name: /create & open camp/i }));
    expect(await screen.findByText(/camp name is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  });

  it('submits a complete camp', async () => {
    api.post.mockResolvedValue({ data: { camp: { id: '1', name: 'Test Camp' } } });
    renderPage();

    await userEvent.type(screen.getByLabelText(/camp name/i), 'Test Camp');
    await userEvent.type(screen.getByLabelText(/^address/i), '12 River Road');
    await userEvent.type(screen.getByLabelText(/^area/i), 'Ward 12');
    await userEvent.type(screen.getByLabelText(/^district/i), 'North District');
    await userEvent.type(screen.getByLabelText(/^state/i), 'Assam');
    await userEvent.type(screen.getByLabelText(/pincode/i), '781001');
    await userEvent.type(screen.getByLabelText(/latitude/i), '26.2');
    await userEvent.type(screen.getByLabelText(/longitude/i), '91.7');
    await userEvent.type(screen.getByLabelText(/beneficiary capacity/i), '400');
    await userEvent.type(screen.getByLabelText(/volunteer capacity/i), '30');
    await userEvent.type(screen.getByLabelText(/duration/i), '14');
    await userEvent.type(screen.getByLabelText(/nearest hospital name/i), 'District Hospital');
    await userEvent.type(screen.getByLabelText(/nearest hospital contact/i), '0484-2000000');
    await userEvent.type(screen.getByLabelText(/nearest police station/i), 'Ward 12 Police Station');
    await userEvent.type(screen.getByLabelText(/nearest police contact/i), '0484-2100000');

    await userEvent.click(screen.getByRole('button', { name: /create & open camp/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/camps', expect.objectContaining({ name: 'Test Camp', beneficiary_capacity: 400 }))
    );
    expect(api.post.mock.calls[0][1].linked_area_id).toBeUndefined();
  });

  it('lets an admin pick an existing area and pre-fills its location fields', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: /existing affected area/i }));
    await user.click(await screen.findByRole('option', { name: /ward 12/i }));

    expect(screen.getByLabelText(/^area/i)).toHaveValue('Ward 12');
    expect(screen.getByLabelText(/^district/i)).toHaveValue('North District');
    expect(screen.getByLabelText(/^state/i)).toHaveValue('Assam');
    expect(screen.getByLabelText(/latitude/i)).toHaveValue('26.2');
    expect(screen.getByLabelText(/longitude/i)).toHaveValue('91.7');
  });

  it('sends the chosen area’s id alongside the camp', async () => {
    api.post.mockResolvedValue({ data: { camp: { id: '1', name: 'Test Camp' } } });
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('combobox', { name: /existing affected area/i }));
    await user.click(await screen.findByRole('option', { name: /ward 12/i }));

    await user.type(screen.getByLabelText(/camp name/i), 'Test Camp');
    await user.type(screen.getByLabelText(/^address/i), '12 River Road');
    await user.type(screen.getByLabelText(/pincode/i), '781001');
    await user.type(screen.getByLabelText(/beneficiary capacity/i), '400');
    await user.type(screen.getByLabelText(/volunteer capacity/i), '30');
    await user.type(screen.getByLabelText(/duration/i), '14');
    await user.type(screen.getByLabelText(/nearest hospital name/i), 'District Hospital');
    await user.type(screen.getByLabelText(/nearest hospital contact/i), '0484-2000000');
    await user.type(screen.getByLabelText(/nearest police station/i), 'Ward 12 Police Station');
    await user.type(screen.getByLabelText(/nearest police contact/i), '0484-2100000');

    await user.click(screen.getByRole('button', { name: /create & open camp/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/camps', expect.objectContaining({ linked_area_id: '64b64b64b64b64b64b64b64b' }))
    );
  });
});
