export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voices, provider, claudeApiKey, claudeModel, geminiApiKey, geminiModel, customApiKey, customBaseUrl, customModel } = req.body;

  if (!text) return res.status(400).json({ error: 'Missing text' });

  const sample = text.slice(0, 5000);
  const safeVoices = Array.isArray(voices) ? voices : [];
  const voiceList = safeVoices.map(v => `- ${v.id}: ${v.name} (${v.tag})`).join('\n');

  const prompt = `You are an expert audiobook producer analyzing a Korean/English novel excerpt.
Your task: identify NAMED HUMAN CHARACTERS and assign TTS voices.

BOOK EXCERPT:
"""
${sample}
"""

AVAILABLE VOICES:
${voiceList}

RULES (CRITICAL):
- Characters must be PROPER NOUN NAMES of actual people/beings in the story (e.g. 고결, 형, 엄마, John)
- DO NOT use verb phrases, action phrases, or dialogue tags as character names (e.g. "말했다", "스태프들에게", "자르며", "슬쩍" are NOT characters)
- DO NOT use location names, object names, or abstract words as characters
- Always include "narrator" as the FIRST entry (for all non-dialogue narration text)
- Maximum 8 characters total (including narrator)
- Assign voices that match the character's personality, gender, and role
- Use distinct hex colors for each character
- In dialogue_patterns, list ONLY the quotation mark styles used (e.g. ["\"...\"", "「...」"])

OUTPUT: Return ONLY valid JSON, no markdown fences, no explanation.

{
  "characters": [
    {
      "name": "narrator",
      "description": "narration and scene description",
      "voice_id": "<id from voice list>",
      "voice_name": "<voice name>",
      "color": "#hex"
    },
    {
      "name": "고결",
      "description": "main protagonist, young male",
      "voice_id": "<id>",
      "voice_name": "<name>",
      "color": "#hex"
    }
  ],
  "dialogue_patterns": ["\"...\""]
}`;

  try {
    let resultText = '';

    if (provider === 'claude') {
      if (!claudeApiKey) return res.status(400).json({ error: 'Missing claudeApiKey' });
      const activeClaudeModel = claudeModel || 'claude-haiku-4-5-20251001';
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: activeClaudeModel,
          max_tokens: 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Claude API error' });
      resultText = data.content?.[0]?.text || '';
    }
    else if (provider === 'gemini') {
      if (!geminiApiKey) return res.status(400).json({ error: 'Missing geminiApiKey' });
      const activeGeminiModel = geminiModel || 'gemini-2.5-pro';
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${activeGeminiModel}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1200, temperature: 0.2 },
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
          max_tokens: 1200,
          temperature: 0.2,
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
