import { useState } from 'react';
import { Alert, Box, Button, Card, CardContent, MenuItem, Stack, TextField, Typography } from '@mui/material';
import { useResourceItems, useCreateResourceItem } from '../../../api/resources.js';
import { toFormErrors } from '../../../api/client.js';

const CATEGORIES = ['food', 'medical', 'clothing', 'shelter', 'hygiene', 'other'];

export function ResourceItemsPage() {
  const { data: items = [], isLoading } = useResourceItems();
  const createItem = useCreateResourceItem();
  const [values, setValues] = useState({ name: '', category: 'food', unit: '' });
  const [error, setError] = useState(null);

  const change = (f) => (e) => setValues((v) => ({ ...v, [f]: e.target.value }));

  async function onSubmit(e) {
    e.preventDefault();
    setError(null);
    try {
      await createItem.mutateAsync(values);
      setValues({ name: '', category: 'food', unit: '' });
    } catch (err) {
      setError(toFormErrors(err).message);
    }
  }

  return (
    <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1.3fr 1fr' }, gap: 3 }}>
      <Box>
        <Typography variant="h5" sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, mb: 2 }}>
          Resource catalog
        </Typography>
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Card key={item.id}>
              <CardContent>
                <Typography sx={{ fontWeight: 600 }}>{item.name}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {item.category} · measured in {item.unit}
                </Typography>
              </CardContent>
            </Card>
          ))}
          {!isLoading && items.length === 0 && (
            <Typography color="text.secondary">No resource items yet.</Typography>
          )}
        </Stack>
      </Box>

      <Card>
        <CardContent>
          <Typography sx={{ fontWeight: 600, mb: 2 }}>Add resource item</Typography>
          {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
          <Box component="form" onSubmit={onSubmit} noValidate>
            <TextField label="Item name" value={values.name} onChange={change('name')} />
            <TextField select label="Category" value={values.category} onChange={change('category')}>
              {CATEGORIES.map((c) => <MenuItem key={c} value={c}>{c}</MenuItem>)}
            </TextField>
            <TextField label="Unit" value={values.unit} onChange={change('unit')} placeholder="kg, liters, pieces…" />
            <Button type="submit" variant="contained" fullWidth disabled={createItem.isPending} sx={{ mt: 2 }}>
              {createItem.isPending ? 'Adding…' : 'Add item'}
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Box>
  );
}
