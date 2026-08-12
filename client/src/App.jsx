import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme.js';
import { AuthProvider } from './AuthProvider.jsx';
import { RequireAuth } from './routes/RequireAuth.jsx';
import { RoleLayout } from './layouts/RoleLayout.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { SignupPage } from './features/auth/SignupPage.jsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// Placeholder home screens. Plan 2 replaces these with the landing page,
// camp management, and the admin dashboard.
const Placeholder = ({ title }) => <h2>{title}</h2>;

export default function App() {
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/signup" element={<SignupPage />} />

              <Route element={<RequireAuth />}>
                <Route element={<RoleLayout />}>
                  <Route path="/" element={<Placeholder title="Relief Portal" />} />
                  <Route path="/donor" element={<Placeholder title="Donor" />} />
                </Route>
              </Route>

              <Route element={<RequireAuth roles={['admin']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/admin" element={<Placeholder title="Administrator" />} />
                </Route>
              </Route>

              <Route element={<RequireAuth roles={['camp_official', 'admin']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/official" element={<Placeholder title="Camp Official" />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
