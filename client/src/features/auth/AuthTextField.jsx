import { TextField } from '@mui/material';

/**
 * Auth-form field styled per the design: label always sits above the input
 * rather than floating into it, matching the prototype's field treatment.
 */
export function AuthTextField({ label, error, helperText, ...props }) {
  return (
    <TextField
      label={label}
      error={Boolean(error)}
      helperText={error ?? helperText}
      slotProps={{ inputLabel: { shrink: true } }}
      sx={{
        '& .MuiInputLabel-root': { fontSize: 12, fontWeight: 600, color: '#5C5C5C', position: 'static', transform: 'none', mb: 0.75 },
        '& .MuiInputLabel-root.Mui-focused': { color: '#5C5C5C' },
        '& .MuiInputBase-root': { mt: 0 },
        '& .MuiOutlinedInput-notchedOutline legend': { display: 'none' },
      }}
      {...props}
    />
  );
}
