import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useCamps } from '../api/camps.js';
import { useAuth } from '../AuthProvider.jsx';

const CampScopeContext = createContext(null);
const STORAGE_KEY = 'frp.selectedCampId';

/**
 * The camp an official is currently working in.
 *
 * Every camp-scoped screen — check-in, distribute, history, volunteer duties —
 * reads its search from this one selection rather than each keeping its own,
 * so switching camps once carries across all of them. The choice survives a
 * reload because losing it mid-shift would silently widen every search back
 * to all camps.
 *
 * An admin may work across every camp, so their selection is optional and an
 * empty one means "all camps". An official's choices are limited to the camps
 * assigned to them, and the server re-checks that on every request — this is
 * a convenience, never the security boundary.
 */
export function CampScopeProvider({ children }) {
  const { user } = useAuth();
  const { data: allCamps = [], isLoading } = useCamps();
  const [campId, setCampId] = useState(() => localStorage.getItem(STORAGE_KEY) ?? '');

  const camps = useMemo(() => {
    if (user?.role !== 'camp_official') return allCamps;
    const mine = new Set(user.assigned_camp_ids ?? []);
    return allCamps.filter((c) => mine.has(c.id));
  }, [allCamps, user]);

  // Drop a selection that is no longer valid — a camp the admin unassigned, or
  // one left in storage by a different account on the same browser. Officials
  // with exactly one camp never see a meaningful choice, so make it for them.
  useEffect(() => {
    if (isLoading) return;
    if (campId && !camps.some((c) => c.id === campId)) {
      setCampId(camps.length === 1 ? camps[0].id : '');
    } else if (!campId && user?.role === 'camp_official' && camps.length === 1) {
      setCampId(camps[0].id);
    }
  }, [camps, campId, isLoading, user]);

  useEffect(() => {
    if (campId) localStorage.setItem(STORAGE_KEY, campId);
    else localStorage.removeItem(STORAGE_KEY);
  }, [campId]);

  const value = useMemo(() => ({
    campId,
    setCampId,
    camps,
    isLoading,
    campName: camps.find((c) => c.id === campId)?.name ?? null,
    // What to send as a query param: '' must not become `camp_id=`.
    params: campId ? { camp_id: campId } : {},
  }), [campId, camps, isLoading]);

  return <CampScopeContext.Provider value={value}>{children}</CampScopeContext.Provider>;
}

export function useCampScope() {
  const ctx = useContext(CampScopeContext);
  if (!ctx) throw new Error('useCampScope must be used inside CampScopeProvider');
  return ctx;
}
