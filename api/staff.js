import { fail, json, requester, requireManager } from './_supabase.js';

// Retain the pre-migration password convention so existing auth.users can
// continue to sign in; new passwords are managed only by this server route.
const pinPassword = pin => `saroutdoors-pin${pin}`;
const validPin = pin => typeof pin === 'string' && /^\d{4}$/.test(pin);
const validName = name => typeof name === 'string' && name.trim().length >= 2 && name.trim().length <= 80;

async function body(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
}

export default async function handler(req, res) {
  if (!['POST', 'PATCH', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed.' });
  try {
    const context = await requester(req);
    requireManager(context.profile);
    const { url, serviceRoleKey, profile } = context;
    const headers = { apikey: serviceRoleKey, Authorization: `Bearer ${serviceRoleKey}`, 'Content-Type': 'application/json' };

    if (req.method === 'POST') {
      const input = await body(req);
      if (!validName(input.name) || !validPin(input.pin)) return json(res, 400, { error: 'Name and a four-digit PIN are required.' });
      const duplicateResponse = await fetch(`${url}/rest/v1/profiles?company_id=eq.${encodeURIComponent(profile.company_id)}&name=ilike.${encodeURIComponent(input.name.trim())}&deleted_at=is.null&select=id`, { headers });
      const duplicates = await duplicateResponse.json();
      if (duplicateResponse.ok && duplicates.length) return json(res, 409, { error: 'A staff member with that name already exists.' });
      const slug = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const email = `${slug}-${crypto.randomUUID()}@users.trailcash.app`;
      const authResponse = await fetch(`${url}/auth/v1/admin/users`, {
        method: 'POST', headers,
        body: JSON.stringify({ email, password: pinPassword(input.pin), email_confirm: true })
      });
      const auth = await authResponse.json();
      if (!authResponse.ok) return json(res, 400, { error: auth.msg || auth.message || 'Could not create the authentication account.' });
      const profileResponse = await fetch(`${url}/rest/v1/profiles`, {
        method: 'POST', headers: { ...headers, Prefer: 'return=representation' },
        body: JSON.stringify({ id: auth.id, company_id: profile.company_id, name: input.name.trim(), email, phone: `staff-${auth.id}`, role: 'Staff', pin: input.pin, status: 'Active' })
      });
      const created = await profileResponse.json();
      if (!profileResponse.ok) {
        await fetch(`${url}/auth/v1/admin/users/${auth.id}`, { method: 'DELETE', headers });
        return json(res, 400, { error: created.message || 'Could not create the staff profile.' });
      }
      return json(res, 201, { staff: created[0] });
    }

    const id = Array.isArray(req.query.id) ? req.query.id[0] : req.query.id;
    if (!id) return json(res, 400, { error: 'Staff id is required.' });
    const targetResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=id,email,role`, { headers });
    const targets = await targetResponse.json();
    const target = targets[0];
    if (!target || target.role === 'Owner') return json(res, 404, { error: 'Staff member was not found.' });

    if (req.method === 'DELETE') {
      const response = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers, body: JSON.stringify({ deleted_at: new Date().toISOString(), status: 'Suspended' }) });
      if (!response.ok) return json(res, 400, { error: 'Could not deactivate staff.' });
      return res.status(204).end();
    }

    const input = await body(req);
    if (!validName(input.name) || (input.pin && !validPin(input.pin))) return json(res, 400, { error: 'Provide a valid name and, if changing it, a four-digit PIN.' });
    if (input.pin) {
      const passwordResponse = await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'PUT', headers, body: JSON.stringify({ password: pinPassword(input.pin) }) });
      if (!passwordResponse.ok) return json(res, 400, { error: 'Could not update the sign-in PIN.' });
    }
    const update = { name: input.name.trim() };
    if (input.pin) update.pin = input.pin;
    const response = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { ...headers, Prefer: 'return=representation' }, body: JSON.stringify(update) });
    const updated = await response.json();
    if (!response.ok) return json(res, 400, { error: updated.message || 'Could not update staff.' });
    return json(res, 200, { staff: updated[0] });
  } catch (error) { return fail(res, error); }
}
