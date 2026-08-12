import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { theme } from './theme.js';
import { AuthProvider } from './AuthProvider.jsx';
import { RequireAuth } from './routes/RequireAuth.jsx';
import { RoleLayout } from './layouts/RoleLayout.jsx';
import { LoginPage } from './features/auth/LoginPage.jsx';
import { SignupPage } from './features/auth/SignupPage.jsx';
import { AreasPage } from './features/admin/areas/AreasPage.jsx';
import { CampsListPage } from './features/admin/camps/CampsListPage.jsx';
import { CreateCampPage } from './features/admin/camps/CreateCampPage.jsx';
import { LandingPage } from './features/landing/LandingPage.jsx';
import { RegistrationWizard } from './features/intake/RegistrationWizard.jsx';
import { CheckInPage } from './features/official/CheckInPage.jsx';
import { DashboardPage } from './features/admin/DashboardPage.jsx';
import { ResourceItemsPage } from './features/admin/resources/ResourceItemsPage.jsx';
import { InventoryPage } from './features/admin/resources/InventoryPage.jsx';
import { DistributionRulesPage } from './features/admin/resources/DistributionRulesPage.jsx';
import { DistributePage } from './features/distribution/DistributePage.jsx';
import { DistributionHistoryPage } from './features/distribution/DistributionHistoryPage.jsx';
import { VolunteerDutyPage } from './features/official/VolunteerDutyPage.jsx';
import { OfficialHomePage } from './features/official/OfficialHomePage.jsx';
import { OfficialsPage } from './features/admin/OfficialsPage.jsx';
import { CampScopeProvider } from './camps/CampScope.jsx';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

// The registration wizard is Plan 3's; this stub covers routes whose real
// screens belong to a later milestone.
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
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/donor" element={<LandingPage />} />
                  <Route path="/register/:campId" element={<RegistrationWizard />} />
                </Route>
              </Route>

              <Route element={<RequireAuth roles={['admin']} />}>
                <Route element={<RoleLayout />}>
                  <Route path="/admin" element={<DashboardPage />} />
                  <Route path="/admin/areas" element={<AreasPage />} />
                  <Route path="/admin/camps" element={<CampsListPage />} />
                  <Route path="/admin/camps/new" element={<CreateCampPage />} />
                  <Route path="/admin/officials" element={<OfficialsPage />} />
                  <Route path="/admin/resources" element={<ResourceItemsPage />} />
                  <Route path="/admin/inventory" element={<InventoryPage />} />
                  <Route path="/admin/distribution-rules" element={<DistributionRulesPage />} />
                </Route>
              </Route>

              {/* The camp bar's selection is shared across every screen in this
                  group, so the provider wraps the group rather than each page. */}
              <Route element={<RequireAuth roles={['camp_official', 'admin']} />}>
                <Route element={<CampScopeProvider><RoleLayout /></CampScopeProvider>}>
                  <Route path="/official" element={<OfficialHomePage />} />
                  <Route path="/official/checkin" element={<CheckInPage />} />
                  <Route path="/official/distribute" element={<DistributePage />} />
                  <Route path="/official/distributions" element={<DistributionHistoryPage />} />
                  <Route path="/official/volunteers" element={<VolunteerDutyPage />} />
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
