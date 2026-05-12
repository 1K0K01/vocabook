export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voices, provider, claudeApiKey, claudeModel, geminiApiKey, geminiModel, customApiKey, customBaseUrl, customModel } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  // ── 샘플 추출: 대화 밀집 구간 우선 ────────────────────────────
  // 따옴표가 많이 나오는 구간 5000자를 선택
  function extractDialogueDenseSample(fullText, sampleSize = 5000) {
    if (fullText.length <= sampleSize) return fullText;

    // 500자 윈도우로 슬라이딩, 따옴표 빈도 가장 높은 위치 찾기
    const windowSize = 500;
    const step = 300;
    let bestScore = -1;
    let bestStart = 0;

    for (let i = 0; i < fullText.length - windowSize; i += step) {
      const window = fullText.slice(i, i + windowSize);
      // 따옴표 + 대화동사 점수
      const quoteCount = (window.match(/["\u201c\u201d\u300c\u300d]/g) || []).length;
      const verbCount = (window.match(/말했다|물었다|소리쳤다|속삭였다|외쳤다|대답했다/g) || []).length;
      const score = quoteCount * 2 + verbCount * 3;
      if (score > bestScore) { bestScore = score; bestStart = i; }
    }

    // bestStart 기준으로 앞뒤 확장해서 sampleSize 확보
    const start = Math.max(0, bestStart - 500);
    return fullText.slice(start, start + sampleSize);
  }

  const sample = extractDialogueDenseSample(text, 5000);

  const safeVoices = Array.isArray(voices) ? voices : [];
  const voiceList = safeVoices.map(v => `- ${v.id}: ${v.name} (${v.tag})`).join('\n');

  const prompt = `You are an expert Korean audiobook producer. Analyze the novel excerpt below.

BOOK EXCERPT:
"""
${sample}
"""

AVAILABLE VOICES:
${voiceList}

== CRITICAL RULES ==

RULE 1 — CHARACTERS must be PROPER NAMES of actual people/beings.
  Valid: 고결, 형, 현무당주, 장로, 엄마, John
  INVALID — DO NOT use:
  - Adverbs/manner: 서둘러, 나지막하게, 조근조근하게, 슬쩍, 갑자기
  - Verb phrases: 말하며, 따르며, 자르며, 하며, 하자
  - Recipient phrases: 은인에게, 스태프들에게, 성요한에게
  - anything ending in: 으로, 에게, 하며, 하자, 이며, 았다, 었다, 라며

RULE 2 — ALWAYS include "narrator" as first character.

RULE 3 — Max 8 characters total (including narrator).

RULE 4 — dialogue_patterns: list ONLY actual quotation styles found.
  Example: ['"..."', '"..."'] — if none found use ['"..."']

RULE 5 — Assign voices matching character gender, age, personality.

== OUTPUT ==
ONLY valid JSON. No markdown. No extra text.

{
  "characters": [
    {
      "name": "narrator",
      "description": "narration and scene description",
      "voice_id": "<id from voice list>",
      "voice_name": "<name>",
      "color": "#hex"
    },
    {
      "name": "현무당주",
      "description": "elder leader of Hyeonmu faction, mature male",
      "voice_id": "<id>",
      "voice_name": "<name>",
      "color": "#hex"
    }
  ],
  "dialogue_patterns": ['"..."']
}`;

  try {
    let resultText = '';

    if (provider === 'claude') {
      if (!claudeApiKey) return res.status(400).json({ error: 'Missing claudeApiKey' });
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: claudeModel || 'claude-haiku-4-5-20251001',
          max_tokens: 1500,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Claude error' });
      resultText = data.content?.[0]?.text || '';
    }
    else if (provider === 'gemini') {
      if (!geminiApiKey) return res.status(400).json({ error: 'Missing geminiApiKey' });
      const r = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel || 'gemini-2.5-pro'}:generateContent?key=${geminiApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 1500, temperature: 0.1 },
          }),
        }
      );
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Gemini error' });
      resultText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }
    else if (provider === 'custom') {
      if (!customApiKey || !customBaseUrl || !customModel)
        return res.status(400).json({ error: 'Missing custom credentials' });
      const r = await fetch(`${customBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${customApiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: customModel,
          max_tokens: 1500,
          temperature: 0.1,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const data = await r.json();
      if (!r.ok) return res.status(r.status).json({ error: data.error?.message || 'Custom API error' });
      resultText = data.choices?.[0]?.message?.content || '';
    }
    else {
      return res.status(400).json({ error: 'Unknown provider' });
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
