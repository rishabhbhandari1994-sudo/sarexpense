import { configuration, json } from './_supabase.js';

const pinPassword = pin => `saroutdoors-pin${pin}`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const input = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    if (!/^[0-9]{4}$/.test(input.pin || '') || typeof input.profileId !== 'string') return json(res, 400, { error: 'A profile and four-digit PIN are required.' });
    const { url, anonKey, serviceRoleKey } = configuration();
    const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(input.profileId)}&deleted_at=is.null&status=eq.Active&select=id,email`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
    });
    const profiles = await profileResponse.json();
    if (!profileResponse.ok || !profiles[0]) return json(res, 401, { error: 'Invalid sign-in details.' });
    const authResponse = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: profiles[0].email, password: pinPassword(input.pin) })
    });
    const session = await authResponse.json();
    if (!authResponse.ok) return json(res, 401, { error: 'Invalid sign-in details.' });
    return json(res, 200, { session });
  } catch (error) { return json(res, 500, { error: error.message }); }
}
