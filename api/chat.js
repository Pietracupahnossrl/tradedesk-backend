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
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await response.json();
      return res.status(200).json(data);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // ── ANTHROPIC PROXY ──
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const body = { ...req.body };

    // Forzar modelo y max_tokens altos
    body.model = 'claude-sonnet-4-5';
    body.max_tokens = 4000;

    // Habilitar web search si el frontend lo pide
    // (no borramos tools, los pasamos tal cual)
    if (!body.tools) {
      body.tools = [{ type: 'web_search_20250305', name: 'web_search' }];
    }

    // Usar streaming para evitar el timeout de 10s de Vercel
    body.stream = true;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'web-search-2025-03-05'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const err = await response.json();
      return res.status(response.status).json(err);
    }

    // Leer el stream completo y reconstruir la respuesta
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let inputTokens = 0;
    let outputTokens = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const event = JSON.parse(data);
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            fullText += event.delta.text;
          }
          if (event.type === 'message_delta' && event.usage) {
            outputTokens = event.usage.output_tokens || 0;
          }
          if (event.type === 'message_start' && event.message?.usage) {
            inputTokens = event.message.usage.input_tokens || 0;
          }
        } catch (e) {
          // línea no parseable, ignorar
        }
      }
    }

    // Devolver en el mismo formato que usa el frontend
    return res.status(200).json({
      content: [{ type: 'text', text: fullText }],
      usage: { input_tokens: inputTokens, output_tokens: outputTokens }
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
