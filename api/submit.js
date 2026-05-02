export default async function handler(req, res) {

  // ── CORS ──────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const debug = req.body?.debug === true;
  const log = (...args) => { if (debug) console.log('[submit]', ...args); };

  try {
    const {
      am_id,
      firstName,
      bizName,
      email,
      bizDesc,
      challenge,
      stage
    } = req.body;

    log('Received submission', { am_id, firstName, email });

    // ── 1. Validate required fields ───────────────────
    if (!am_id || !firstName || !email) {
      return res.status(400).json({ error: 'Missing required fields: am_id, firstName, email' });
    }

    // ── 2. Look up affiliate in Supabase ──────────────
    const supabaseUrl  = process.env.SUPABASE_URL;
    const supabaseKey  = process.env.SUPABASE_ANON_KEY;

    log('Querying Supabase for am_id:', am_id);

    const sbRes = await fetch(
      `${supabaseUrl}/rest/v1/affiliates?am_id=eq.${encodeURIComponent(am_id)}&active=eq.true&limit=1`,
      {
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    const affiliates = await sbRes.json();
    log('Supabase response:', affiliates);

    if (!affiliates || affiliates.length === 0) {
      return res.status(404).json({ error: `No active affiliate found for am_id: ${am_id}` });
    }

    const affiliate = affiliates[0];
    log('Affiliate found:', affiliate.name);

    // ── 3. Fire webhook to affiliate's GHL sub-portal ─
    const contactPayload = {
      firstName,
      lastName:  '',
      email,
      phone:     '',
      source:    'CSA Roadmap App',
      tags:      ['CSA-Roadmap-Completed', `affiliate-${am_id}`],
      customFields: {
        bizName,
        bizDesc,
        challenge,
        stage,
        am_id
      },
      timestamp: new Date().toISOString()
    };

    log('Firing webhook to:', affiliate.webhook_url);
    log('Contact payload:', contactPayload);

    let webhookStatus = 'skipped';

    if (affiliate.webhook_url && !affiliate.webhook_url.includes('PLACEHOLDER')) {
      const whRes = await fetch(affiliate.webhook_url, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(contactPayload)
      });
      webhookStatus = whRes.ok ? 'success' : `failed (${whRes.status})`;
      log('Webhook response status:', webhookStatus);
    } else {
      log('Webhook skipped — placeholder URL detected');
    }

    // ── 4. Return affiliate data to frontend ──────────
    const responsePayload = {
      success: true,
      partner: {
        name:        affiliate.name,
        calendarUrl: affiliate.calendar_url
      },
      ...(debug && {
        _debug: {
          am_id,
          affiliateLookup: 'success',
          webhookStatus,
          contactPayload
        }
      })
    };

    log('Returning response:', responsePayload);
    return res.status(200).json(responsePayload);

  } catch (err) {
    console.error('[submit] Unhandled error:', err);
    return res.status(500).json({
      error: 'Internal server error',
      ...(req.body?.debug && { _debug: { message: err.message, stack: err.stack } })
    });
  }
}
