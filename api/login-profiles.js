import { configuration, json } from './_supabase.js';

// Only non-sensitive display data is exposed before authentication. PIN hashes,
// email addresses, phone numbers, and tenant ids never leave the server here.
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const { url, serviceRoleKey } = configuration();
    const response = await fetch(`${url}/rest/v1/profiles?deleted_at=is.null&status=eq.Active&select=id,name,role&order=name.asc`, {
      headers: { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}` }
    });
    const rows = await response.json();
    if (!response.ok) return json(res, 500, { error: 'Unable to load the sign-in list.' });
    return json(res, 200, { profiles: rows });
  } catch (error) { return json(res, 500, { error: error.message }); }
}
