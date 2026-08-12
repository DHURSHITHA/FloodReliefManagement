import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RegistrationWizard } from './RegistrationWizard.jsx';
import { api } from '../../api/client.js';

vi.mock('../../api/client.js', async (orig) => {
  const actual = await orig();
  return { ...actual, api: { ...actual.api, post: vi.fn() } };
});

function renderPage(campId = '507f1f77bcf86cd799439011') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/register/${campId}`]}>
        <Routes><Route path="/register/:campId" element={<RegistrationWizard />} /></Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); });

async function fillApplicant() {
  await userEvent.type(screen.getByLabelText(/full name/i), 'Meena Devi');
  await userEvent.type(screen.getByLabelText(/age/i), '34');
  await userEvent.click(screen.getByLabelText(/gender/i));
  await userEvent.click(await screen.findByRole('option', { name: /^female$/i }));
  await userEvent.type(screen.getByLabelText(/aadhaar number/i), '234567890239');
  await userEvent.type(screen.getByLabelText(/mobile number/i), '9876543210');
  await userEvent.type(screen.getByLabelText(/address/i), '12 River Road');
}

describe('RegistrationWizard', () => {
  it('submits an applicant registering alone', async () => {
    api.post.mockResolvedValue({ data: { beneficiary: { id: '1', beneficiary_code: 'BEN-1001' }, members: [] } });
    renderPage();
    await fillApplicant();
    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith(
        '/registrations',
        expect.objectContaining({ camp_id: '507f1f77bcf86cd799439011' }),
        expect.anything()
      )
    );
    expect(await screen.findByText(/BEN-1001/)).toBeInTheDocument();
  }, 20000);

  it('adds a family member and requires their relation to the applicant', async () => {
    renderPage();
    await fillApplicant();
    await userEvent.click(screen.getByRole('button', { name: /add family member/i }));

    const memberNames = screen.getAllByLabelText(/full name/i);
    await userEvent.type(memberNames[1], 'Raju Devi');
    await userEvent.type(screen.getAllByLabelText(/age/i)[1], '8');
    await userEvent.click(screen.getAllByLabelText(/gender/i)[1]);
    await userEvent.click(await screen.findByRole('option', { name: /^male$/i }));
    await userEvent.type(screen.getAllByLabelText(/aadhaar number/i)[1], '234567890111');

    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));
    expect(await screen.findByText(/relation to the applicant is required/i)).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
  }, 20000);

  it('flags the exact colliding member on a 409 duplicate response, keeping other fields intact', async () => {
    api.post.mockRejectedValue({
      response: {
        data: {
          error: {
            code: 'DUPLICATE_AADHAAR', message: 'Please correct the highlighted fields.',
            details: [{ path: 'members.0.aadhaar', message: 'This person already has an active registration.' }],
          },
        },
      },
    });
    renderPage();
    await fillApplicant();
    await userEvent.click(screen.getByRole('button', { name: /submit registration/i }));

    expect(await screen.findByText(/already has an active registration/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/full name/i)).toHaveValue('Meena Devi'); // not lost
  }, 20000);
});
