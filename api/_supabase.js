const json = (res, status, payload) => res.status(status).json(payload);

export function configuration() {
  const url = process.env.SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceRoleKey) throw new Error('Supabase server configuration is incomplete.');
  return { url, anonKey, serviceRoleKey };
}

export async function requester(req) {
  const { url, anonKey, serviceRoleKey } = configuration();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) throw new Error('Authentication is required.');
  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
  if (!userResponse.ok) throw new Error('Session is invalid or expired.');
  const user = await userResponse.json();
  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=id,company_id,role,status,deleted_at`, {
    headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
  });
  const profiles = await profileResponse.json();
  const profile = profiles[0];
  if (!profile || profile.status !== 'Active' || profile.deleted_at) throw new Error('Your account is inactive.');
  return { user, profile, url, anonKey, serviceRoleKey };
}

export function requireManager(profile) {
  if (!['Owner', 'Manager'].includes(profile.role)) throw new Error('Manager access is required.');
}

export function fail(res, error) {
  return json(res, error.message === 'Manager access is required.' ? 403 : 401, { error: error.message });
}

export { json };
