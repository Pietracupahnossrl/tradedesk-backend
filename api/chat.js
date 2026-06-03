export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── YAHOO FINANCE PROXY ──
  if (req.method === 'GET' && req.query.yahoo) {
    try {
      const { yahoo: ticker, interval = '1d', range = '1y' } = req.query;
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=${interval}&range=${range}`;
      const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ANTHROPIC PROXY CON STREAMING ──
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = { ...req.body };
    body.model = 'claude-sonnet-4-5';
    body.max_tokens = 8000;
    body.stream = true;

    if (!body.tools) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(body)
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.json();
      return res.status(anthropicRes.status).json(err);
    }

    // Stream SSE directo al cliente
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const reader = anthropicRes.body.getReader();
    const decoder = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      // Reenviar cada chunk SSE al cliente tal cual
      res.write(chunk);
    }

    res.end();

  } catch (err) {
    // Si ya empezamos a hacer stream, no podemos cambiar el status
    try { res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`); } catch(e) {}
    res.end();
  }
}
