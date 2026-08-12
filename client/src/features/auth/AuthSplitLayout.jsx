import { Box, Typography } from '@mui/material';

/**
 * Shared shell for the Login and Signup screens, matching the approved
 * Flood Relief Portal design: an orange hero panel on the left carrying the
 * brand story, and a centered form panel on the right. Collapses to a single
 * column on narrow viewports.
 */
export function AuthSplitLayout({ children }) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1.05fr .95fr' },
        minHeight: '100dvh',
      }}
    >
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          bgcolor: '#C44E00',
          color: '#fff',
          display: 'flex',
          flexDirection: 'column',
          px: { xs: 3, md: 7 },
          py: { xs: 4, md: 7 },
          minHeight: { xs: 280, md: 'auto' },
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            inset: 0,
            background: 'radial-gradient(120% 90% at 12% 0%, #FF6B00 0%, rgba(255,107,0,0) 62%)',
          }}
        />
        <Box sx={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box
            sx={{
              width: 38, height: 38, borderRadius: '10px',
              bgcolor: 'rgba(255,255,255,.18)', border: '1px solid rgba(255,255,255,.28)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            🌊
          </Box>
          <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 17 }}>
            Flood Relief Portal
          </Typography>
        </Box>

        <Box sx={{ position: 'relative', mt: 'auto' }}>
          <Typography
            component="h1"
            sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: { xs: 28, md: 42 }, lineHeight: 1.15, maxWidth: '15ch' }}
          >
            One account. Every step of relief.
          </Typography>
          <Typography sx={{ mt: 2.25, fontSize: 15.5, lineHeight: 1.65, color: 'rgba(255,255,255,.85)', maxWidth: '44ch' }}>
            Affected persons, camp officials, donors and administrators sign in through
            the same door. Your role decides what you see next.
          </Typography>
          <Box sx={{ display: 'flex', gap: 3.25, mt: 4.25, pt: 3, borderTop: '1px solid rgba(255,255,255,.2)' }}>
            {[
              ['18', 'Camps open now'],
              ['2,140', 'Beneficiaries registered'],
              ['No OTP', 'Password sign-in only'],
            ].map(([n, label]) => (
              <Box key={label}>
                <Typography sx={{ fontFamily: '"Lora", Georgia, serif', fontWeight: 600, fontSize: 24 }}>{n}</Typography>
                <Typography sx={{ fontSize: 12.5, color: 'rgba(255,255,255,.72)', mt: 0.25 }}>{label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 3, md: 5 }, bgcolor: '#fff' }}>
        <Box sx={{ width: '100%', maxWidth: 432 }}>{children}</Box>
      </Box>
    </Box>
  );
}
