export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voices, provider, claudeApiKey, claudeModel, geminiApiKey, geminiModel, customApiKey, customBaseUrl, customModel } = req.body;

  if (!text) return res.status(400).json({ error: 'Missing text' });

  const sample = text.slice(0, 4000);
  const voiceList = voices.map(v => `- ${v.id}: ${v.name} (${v.tag})`).join('\n');

  const prompt = `You are analyzing a book excerpt to identify characters and assign TTS voices for an audiobook.

BOOK EXCERPT:
"""
${sample}
"""

AVAILABLE VOICES:
${voiceList}

TASK:
1. Identify all speaking characters (including "narrator"/"나레이터" for non-dialogue text)
2. Assign the most fitting voice from the list above to each character
3. Return ONLY valid JSON, no explanation

OUTPUT FORMAT (strict JSON, no markdown):
{
  "characters": [
    {
      "name": "narrator",
      "description": "narration / description text",
      "voice_id": "<voice id from list>",
      "voice_name": "<voice name>",
      "color": "#hex color"
    },
    {
      "name": "캐릭터이름",
      "description": "brief role description",
      "voice_id": "<voice id>",
      "voice_name": "<voice name>",
      "color": "#hex color"
    }
  ],
  "dialogue_patterns": ["pattern1", "pattern2"]
}

Rules:
- Always include "narrator" as first character
- Max 8 characters
- Assign distinct, thematically fitting voices
- Use distinct hex colors for each character
- dialogue_patterns: list of dialogue quote styles found (e.g. ['"..."', '"..."', '「...」'])`;

  try {
    let resultText = '';

    if (provider === 'claude') {
      if (!claudeApiKey) return res.status(400).json({ error: 'Missing claudeApiKey' });
      const activeClaudeModel = claudeModel || 'claude-3-haiku-20240307';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: activeClaudeModel,
          max_tokens: 1024,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Claude API error' });
      resultText = data.content?.[0]?.text || '';
    }
    else if (provider === 'gemini') {
      if (!geminiApiKey) return res.status(400).json({ error: 'Missing geminiApiKey' });
      const activeGeminiModel = geminiModel || 'gemini-1.5-pro';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${activeGeminiModel}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1024, temperature: 0.3, response_mime_type: "application/json" },
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Gemini API error' });
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    else if (provider === 'custom') {
      if (!customApiKey || !customBaseUrl || !customModel) {
        return res.status(400).json({ error: 'Missing customApiKey, customBaseUrl, or customModel' });
      }
      const base = customBaseUrl.replace(/\/$/, '');
      const r = await fetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${customApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: customModel,
          max_tokens: 1024,
          temperature: 0.3,
          response_format: { type: "json_object" },
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Custom API error' });
      resultText = data.choices?.[0]?.message?.content || '';
    }
    else {
      return res.status(400).json({ error: 'Unknown provider. Use "claude", "gemini", or "custom".' });
    }

    const cleaned = resultText.replace(/```json|```/g, '').trim();
    try {
      return res.status(200).json(JSON.parse(cleaned));
    } catch {
      return res.status(200).json({ raw: resultText, parseError: true });
    }

  } catch (err) {
    return res.status(500).json({ error: err.message, parseError: true });
  }
}
