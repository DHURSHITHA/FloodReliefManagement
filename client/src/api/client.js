import axios from 'axios';

// In memory only. localStorage is readable by any injected script; a variable
// dies with the tab, and the httpOnly refresh cookie restores the session on
// reload without ever exposing a token to javascript.
let accessToken = null;

export const setAccessToken = (t) => { accessToken = t; };
export const getAccessToken = () => accessToken;

export const api = axios.create({
  baseURL: '/api',
  withCredentials: true, // send the refresh cookie
});

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Share one refresh across concurrent 401s, so ten parallel requests do not
// fire ten rotations and trip the token-reuse defence.
let refreshing = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const status = error.response?.status;
    const isAuthCall = original?.url?.includes('/auth/login') || original?.url?.includes('/auth/refresh');

    if (status !== 401 || original?._retried || isAuthCall) {
      return Promise.reject(error);
    }

    original._retried = true;
    refreshing ??= api
      .post('/auth/refresh')
      .then(({ data }) => { setAccessToken(data.access_token); return data.access_token; })
      .catch((err) => { setAccessToken(null); throw err; })
      .finally(() => { refreshing = null; });

    try {
      await refreshing;
      return api(original);
    } catch {
      return Promise.reject(error);
    }
  }
);

/** Normalize the server's error envelope into something a form can render. */
export function toFormErrors(error) {
  const envelope = error?.response?.data?.error;
  return {
    code: envelope?.code ?? 'NETWORK',
    message: envelope?.message ?? 'Could not reach the server. Check your connection.',
    fields: Object.fromEntries((envelope?.details ?? []).map((d) => [d.path, d.message])),
  };
}
