import { useState } from 'react';
import {
  Alert, Box, Button, Card, CardContent, IconButton, MenuItem, Stack, TextField, Typography,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { DONATION_TYPES } from '@frp/shared';
import { useRaiseDonation, useMyDonations, useMyDonorProfile } from '../../api/donations.js';
import { useCamps } from '../../api/camps.js';
import { useResourceItems } from '../../api/resources.js';
import { toFormErrors } from '../../api/client.js';
import { DonationCard } from './DonationCard.jsx';

const TYPE_LABELS = { financial: 'Financial', material: 'Material' };

const emptyMaterialRow = () => ({ resource_item_id: '', quantity: '', unit: '', estimated_value: '', remarks: '' });

/**
 * Where a donor records a gift and watches what happened to the last one —
 * the same "raise it, watch it" pattern as complaints and SOS. Blocked
 * behind a profile: donations.service.js's resolveDonor requires one, so a
 * donor who has not filled theirs in yet is sent there instead of hitting
 * a confusing 400 on submit.
 */
export function DonationEntryPage() {
  const { data: donor, isLoading: profileLoading } = useMyDonorProfile();
  const { data: camps = [] } = useCamps();
  const { data: items = [] } = useResourceItems();
  const { data: mine = [], isLoading: historyLoading } = useMyDonations();
  const raise = useRaiseDonation();

  const [donationType, setDonationType] = useState('financial');
  const [targetCampId, setTargetCampId] = useState('');
  const [purpose, setPurpose] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [materials, setMaterials] = useState([emptyMaterialRow()]);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(null);

  if (profileLoading) return <Typography color="text.secondary">Loading…</Typography>;

  if (!donor) {
    return (
      <Alert severity="info" sx={{ maxWidth: 560 }}>
        Create your donor profile before recording a donation.{' '}
        <RouterLink to="/donor/profile">Set it up now.</RouterLink>
      </Alert>
    );
  }

  const changeMaterial = (i, field) => (e) => {
    const next = [...materials];
    next[i] = { ...next[i], [field]: e.target.value };
    setMaterials(next);
  };
  const addRow = () => setMaterials((m) => [...m, emptyMaterialRow()]);
  const removeRow = (i) => setMaterials((m) => m.filter((_, idx) => idx !== i));

  const financialValid = donationType === 'financial' && Number(amount) > 0 && paymentMethod.trim().length > 0;
  const materialValid = donationType === 'material' && materials.every((m) => m.resource_item_id && Number(m.quantity) > 0 && m.unit.trim());
  const canSubmit = donationType === 'financial' ? financialValid : materialValid;

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    setSent(null);
    try {
      const payload = {
        donation_type: donationType,
        target_camp_id: targetCampId || undefined,
        purpose: purpose || undefined,
        ...(donationType === 'financial'
          ? { amount: Number(amount), payment_method: paymentMethod, payment_reference: paymentReference || undefined }
          : {
              materials: materials.map((m) => ({
                resource_item_id: m.resource_item_id, quantity: Number(m.quantity), unit: m.unit,
                estimated_value: m.estimated_value ? Number(m.estimated_value) : undefined,
                remarks: m.remarks || undefined,
              })),
            }),
      };
      const created = await raise.mutateAsync(payload);
      setSent(`Recorded as ${created.donation_code}. An admin will confirm it shortly.`);
      setAmount(''); setPaymentMethod(''); setPaymentReference(''); setPurpose('');
      setMaterials([emptyMaterialRow()]);
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 4, alignItems: 'start' }}>
      <Card>
        <CardContent>
          <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 0.5 }}>
            Record a donation
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Every donation is confirmed by an admin before it counts.
          </Typography>

          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          {sent && <Alert severity="success" sx={{ mb: 2 }}>{sent}</Alert>}

          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField select label="Type" value={donationType} onChange={(e) => setDonationType(e.target.value)}>
              {DONATION_TYPES.map((t) => <MenuItem key={t} value={t}>{TYPE_LABELS[t] ?? t}</MenuItem>)}
            </TextField>

            <TextField select label="Target camp (optional)" value={targetCampId} onChange={(e) => setTargetCampId(e.target.value)}>
              <MenuItem value="">General — no specific camp</MenuItem>
              {camps.map((c) => <MenuItem key={c.id} value={c.id}>{c.name}</MenuItem>)}
            </TextField>

            <TextField label="Purpose (optional)" value={purpose} onChange={(e) => setPurpose(e.target.value)} />

            {donationType === 'financial' ? (
              <>
                <TextField label="Amount" type="number" value={amount} onChange={(e) => setAmount(e.target.value)} />
                <TextField label="How was this paid" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} placeholder="Cash, UPI, cheque, bank transfer…" />
                <TextField label="Payment reference (optional)" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} />
              </>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 1, mb: 2 }}>
                {materials.map((m, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <TextField select label="Item" value={m.resource_item_id} onChange={changeMaterial(i, 'resource_item_id')} sx={{ flex: 2, mb: 0 }}>
                      {items.map((it) => <MenuItem key={it.id} value={it.id}>{it.name}</MenuItem>)}
                    </TextField>
                    <TextField label="Quantity" type="number" value={m.quantity} onChange={changeMaterial(i, 'quantity')} sx={{ flex: 1, mb: 0 }} />
                    <TextField label="Unit" value={m.unit} onChange={changeMaterial(i, 'unit')} sx={{ flex: 1, mb: 0 }} />
                    <IconButton aria-label="Remove item" onClick={() => removeRow(i)} disabled={materials.length === 1} sx={{ mt: 0.5 }}>
                      ✕
                    </IconButton>
                  </Box>
                ))}
                <Button onClick={addRow} size="small" sx={{ alignSelf: 'flex-start' }}>+ Add another item</Button>
              </Stack>
            )}

            <Button type="submit" variant="contained" fullWidth sx={{ mt: 2 }} disabled={raise.isPending || !canSubmit}>
              {raise.isPending ? 'Recording…' : 'Record donation'}
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Box>
        <Typography sx={{ fontWeight: 600, mb: 1.5 }}>Your donations</Typography>
        <Stack spacing={1.5}>
          {mine.map((d) => <DonationCard key={d.id} donation={d} />)}
          {!historyLoading && mine.length === 0 && (
            <Typography color="text.secondary" variant="body2">You have not recorded a donation yet.</Typography>
          )}
        </Stack>
      </Box>
    </Box>
  );
}
