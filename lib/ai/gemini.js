const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent';

// ============================================
// CALL GEMINI API
// ============================================
export async function callGemini(contents, options = {}) {
  const API_KEY = process.env.GEMINI_API_KEY;
  
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY not set');
  }

  const {
    temperature = 0.7,
    maxOutputTokens = 500,
    topP = 0.9
  } = options;

  const response = await fetch(`${GEMINI_API_URL}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      generationConfig: {
        temperature,
        maxOutputTokens,
        topP
      }
    })
  });

  if (response.status === 429) {
    throw new Error('RATE_LIMITED');
  }

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Gemini error:', response.status, errorText);
    throw new Error('AI service error');
  }

  const data = await response.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ============================================
// BUILD CHAT CONTENTS
// ============================================
export function buildChatContents(systemPrompt, greeting, history, currentPrompt) {
  const contents = [];

  // System prompt as first user message
  contents.push({
    role: 'user',
    parts: [{ text: systemPrompt }]
  });

  // AI greeting
  contents.push({
    role: 'model',
    parts: [{ text: greeting || 'Hej! Hur kan jag hjälpa dig?' }]
  });

  // History
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.sender_type === 'human') {
        // Staff message - tell AI that staff responded
        contents.push({
          role: 'user',
          parts: [{ text: `[PERSONALENS SVAR: "${msg.content}"]` }]
        });
        contents.push({
          role: 'model',
          parts: [{ text: 'Jag noterar att personalen har svarat.' }]
        });
      } else {
        contents.push({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        });
      }
    }
  }

  // Current prompt
  contents.push({
    role: 'user',
    parts: [{ text: currentPrompt }]
  });

  return contents;
}

// ============================================
// BUILD SYSTEM PROMPT
// ============================================
export function buildSystemPrompt(aiConfig, triggeredActions = []) {
  let systemPrompt = aiConfig.system_prompt || '';

  // Add knowledge base
  if (aiConfig.knowledge_base) {
    systemPrompt += `\n\n## KUNSKAP (använd denna info för att svara):\n${aiConfig.knowledge_base}`;
  }

  // Add context from triggered actions
  for (const action of triggeredActions) {
    if (action.action_type === 'add_context' && action.action_config?.text) {
      systemPrompt += `\n\n## EXTRA INSTRUKTION:\n${action.action_config.text}`;
    }
  }

  return systemPrompt;
}
