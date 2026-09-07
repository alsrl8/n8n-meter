// n8n 2.26.9 /rest/login returns the current public user after validating its session.
export function sessionAuthenticator(upstream) {
  const base = new URL(upstream);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Invalid n8n upstream');
  return async (cookie) => {
    if (!cookie) return 401;
    try {
      const response = await fetch(new URL('/rest/login', base), {
        headers: {cookie}, redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (response.status === 401 || response.status === 403) return 401;
      if (!response.ok) return 503;
      const user = (await response.json())?.data;
      if (!user?.id || !['global:owner', 'global:admin'].includes(user.role) || user.disabled || (user.mfaEnabled && user.mfaAuthenticated !== true)) return 403;
      return 200;
    } catch { return 503; }
  };
}
