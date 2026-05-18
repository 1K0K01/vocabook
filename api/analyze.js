export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { text, voices, provider, claudeApiKey, claudeModel, geminiApiKey, geminiModel, customApiKey, customBaseUrl, customModel } = req.body;
  if (!text) return res.status(400).json({ error: 'Missing text' });

  // ── 스마트 샘플 추출: 도입부 + 대화 밀집 + 중반부 조합 ─────────
  function extractSmartSample(fullText, targetSize = 6000) {
    if (fullText.length <= targetSize) return fullText;

    const intro = fullText.slice(0, 1500);
    const windowSize = 600;
    const step = 300;
    let bestScore = -1;
    let bestStart = 1500;

    for (let i = 1500; i < fullText.length - windowSize; i += step) {
      const win = fullText.slice(i, i + windowSize);
      const quoteCount = (win.match(/["\u201c\u201d\u300c\u300d\u300e\u300f]/g) || []).length;
      const verbCount = (win.match(/말했다|물었다|소리쳤다|속삭였다|외쳤다|대답했다|말하며|웃으며|중얼거렸다/g) || []).length;
      const nameCount = (win.match(/[가-힣]{1,4}(?:이|가|은|는)\s/g) || []).length;
      const score = quoteCount * 2 + verbCount * 3 + nameCount;
      if (score > bestScore) { bestScore = score; bestStart = i; }
    }

    const dialogueSample = fullText.slice(
      Math.max(1500, bestStart - 200),
      Math.min(fullText.length, bestStart + 2500)
    );

    const midStart = Math.max(Math.floor(fullText.length / 3), bestStart + 2500);
    const midSample = fullText.slice(midStart, midStart + 1500);

    const combined = intro + '\n\n[...중략...]\n\n' + dialogueSample + '\n\n[...중략...]\n\n' + midSample;
    return combined.slice(0, targetSize + 1000);
  }

  const sample = extractSmartSample(text, 6000);
  const safeVoices = Array.isArray(voices) ? voices : [];
  const voiceList = safeVoices.map(v => `- ${v.id}: ${v.name} (${v.tag})`).join('\n');

  const prompt = `당신은 한국 웹소설/이북 전문 오디오북 제작자입니다. 아래 소설 발췌문을 **내용을 충분히 이해한 후** 등장인물과 대화 패턴을 분석하세요.

== 이북 분석 핵심 원칙 ==

한국 이북/웹소설은 대본과 달리 화자 표시가 없습니다. 화자를 찾으려면:
1. **맥락으로 화자 파악**: 직전 문장의 행동/감정 주체, 대화 흐름, 인물 간 관계를 이해하세요
2. **대화 직후 서술 활용**: "그가 말했다", "현무당주가 무참한 목소리를 냈다" 등 대화 직후 서술로 화자를 확인하세요
3. **이름 없어도 화자 판단**: 문맥상 누가 말하는지 논리적으로 추론하세요
4. **연속 대화 흐름 추적**: 같은 인물이 연속 발언할 수 있으므로 대화 흐름 전체를 읽으세요
5. **등장인물 관계 파악**: 주인공, 조력자, 적, 조연 등의 관계를 이해하고 캐릭터를 구분하세요

== 등장인물 추출 RULE ==

RULE 1 — 반드시 실제 인물/존재의 고유명칭만. 인물이 아닌 것은 절대 출력 금지.

  ✅ 유효한 예: 고결, 형, 현무당주, 장로, 엄마, 서아, 베어, 사헌, 서을
  ❌ 절대 무효 — 아래 중 하나라도 해당하면 캐릭터에서 제외:

  [동사/행동 묘사]
  끊으며, 웃으며, 말하며, 속삭이며, 소리치며, 외치며, 울먹이며,
  하며, 하자, 하고, 이며, 라며, 라고, 하여, 하니, 했다, 한다

  [방식/부사]
  나지막하게, 조근조근하게, 나직하게, 서둘러, 슬쩍, 갑자기,
  천천히, 조용히, 빠르게, 무겁게, 차갑게

  [조사구/수신구]
  은인에게, 스태프들에게, 장로들에게, 그에게, 그녀에게

  [어미로 끝나는 것]
  ~으며, ~하며, ~이며, ~라며, ~라고, ~하자, ~이자,
  ~았다, ~었다, ~했다, ~한다, ~겠다,
  ~으로, ~에게, ~에서, ~부터, ~까지, ~처럼, ~보다

  [행동/방식으로 시작하는 것]
  말~, 소리~, 속삭~, 웃~, 울~, 끊~, 잡~, 뛰~

  테스트: "이 단어가 소설에서 대사를 말하는 실존 인물/존재인가?"
  YES → 포함 / NO 또는 불확실 → 제외

RULE 2 — "narrator"를 반드시 첫 번째로 포함

RULE 3 — 최대 8명 (narrator 포함), 실제 대사나 행동이 있는 인물만

RULE 4 — dialogue_patterns: 실제 사용된 따옴표 형식만
  예: ['"..."'] — 발견 못하면 ['"..."']

RULE 5 — 보이스는 캐릭터 성별·나이·성격에 맞게 배정

소설 발췌:
"""
${sample}
"""

사용 가능한 보이스:
${voiceList}

== 출력 ==
유효한 JSON만 출력. 마크다운이나 부연설명 없이.

{
  "characters": [
    {
      "name": "narrator",
      "description": "내레이션 및 장면 묘사",
      "voice_id": "<보이스 목록의 id>",
      "voice_name": "<보이스 이름>",
      "color": "#hex색상"
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
          max_tokens: 2000,
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
            generationConfig: { maxOutputTokens: 2000, temperature: 0.1 },
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
          max_tokens: 2000,
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

    // JSON 추출: 마크다운 펜스 제거 후 JSON 블록만 추출
    let cleaned = resultText.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) cleaned = jsonMatch[0];

    try {
      return res.status(200).json(JSON.parse(cleaned));
    } catch {
      return res.status(200).json({ raw: resultText, parseError: true });
    }
  } catch (err) {
    return res.status(500).json({ error: err.message, parseError: true });
  }
}
