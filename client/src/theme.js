import { createTheme } from '@mui/material/styles';

// Design tokens taken from the approved "Flood Relief Portal" prototype
// (Claude Design project, Flood Relief Portal.dc.html). Deliberately
// high-contrast and large-target as well: this is used on cheap phones, in
// bad light, by stressed people, sometimes on a wet screen.
export const theme = createTheme({
  palette: {
    primary: { main: '#FF6B00', dark: '#C44E00', contrastText: '#fff' },
    secondary: { main: '#C44E00', contrastText: '#fff' },
    error: { main: '#C0392B', light: '#FDECEA', dark: '#8C2A1E' },
    warning: { main: '#8A5B0C', light: '#FEF6E7', dark: '#B45309' },
    success: { main: '#1E8E4A', light: '#E9F7EE' },
    text: { primary: '#2B2B2B', secondary: '#6B6B6B', disabled: '#9A9A9A' },
    divider: '#E4D9CE',
    background: { default: '#FAF6F2', paper: '#ffffff' },
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif',
    h1: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    h2: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    h3: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    h4: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    h5: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    h6: { fontFamily: '"Lora", Georgia, serif', fontWeight: 600 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { size: 'large' },
      styleOverrides: {
        root: { borderRadius: 9, minHeight: 44 },
        containedPrimary: {
          boxShadow: '0 10px 22px -12px rgba(196,78,0,.75)',
          '&:hover': { backgroundColor: '#C44E00' },
        },
      },
    },
    MuiTextField: { defaultProps: { fullWidth: true, margin: 'normal' } },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 9,
          '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
            borderColor: '#FF6B00',
            boxShadow: '0 0 0 3px rgba(255,107,0,.14)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 14,
          border: '1px solid #F0E2D5',
          boxShadow: '0 1px 2px rgba(43,43,43,.03), 0 14px 30px -24px rgba(43,43,43,.4)',
        },
      },
    },
    MuiChip: { styleOverrides: { root: { borderRadius: 20, fontWeight: 600 } } },
  },
});
