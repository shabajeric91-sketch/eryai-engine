import { callGemini } from './gemini.js';

// ============================================
// CHECK IF ANALYSIS SHOULD RUN
// ============================================
export function shouldRunAnalysis(conversation, aiResponse, analysisConfig) {
  if (!analysisConfig?.enable_analysis) {
    return { shouldRun: false, triggers: {} };
  }

  const recentMessages = conversation.slice(-4).map(m => m.content).join(' ').toLowerCase();

  // Check triggers from config
  const emailPattern = new RegExp(
    analysisConfig.email_pattern?.replace(/^\/|\/$/g, '') || '@', 
    'i'
  );
  const phonePattern = new RegExp(
    analysisConfig.phone_pattern?.replace(/^\/|\/$/g, '') || '(\\d{3,4}[\\s-]?\\d{2,3}[\\s-]?\\d{2,4}|\\d{10,})', 
    'i'
  );

  const complaintKeywords = (analysisConfig.complaint_keywords || '').split(',').map(k => k.trim().toLowerCase());
  const humanKeywords = (analysisConfig.human_request_keywords || '').split(',').map(k => k.trim().toLowerCase());
  const specialKeywords = (analysisConfig.special_request_keywords || '').split(',').map(k => k.trim().toLowerCase());
  const unsurePatterns = (analysisConfig.ai_unsure_patterns || '').split(',').map(k => k.trim().toLowerCase());

  const triggers = {
    hasEmail: emailPattern.test(recentMessages),
    hasPhone: phonePattern.test(recentMessages),
    hasComplaint: complaintKeywords.some(k => k && recentMessages.includes(k)),
    wantsHuman: humanKeywords.some(k => k && recentMessages.includes(k)),
    hasSpecialRequest: specialKeywords.some(k => k && recentMessages.includes(k)),
    aiUnsure: unsurePatterns.some(p => p && aiResponse.toLowerCase().includes(p))
  };

  const shouldRun = Object.values(triggers).some(v => v);

  return { shouldRun, triggers };
}

// ============================================
// ANALYZE CONVERSATION WITH GEMINI
// ============================================
export async function analyzeConversation(conversation, aiName, retryCount = 0) {
  const conversationText = conversation
    .map(msg => `${msg.role === 'user' ? 'Gäst' : aiName}: ${msg.content}`)
    .join('\n');

  const analysisPrompt = `Analysera denna restaurangkonversation noggrant:

${conversationText}

Avgör:
1. Om det finns en KOMPLETT reservation (datum + tid + antal + namn + kontakt)
2. Om gästen ställt en fråga som ${aiName} INTE kunde svara på
3. Om gästen uttryckt missnöje eller klagomål
4. Om gästen explicit bett att prata med personal/chef

Svara ENDAST med JSON (ingen annan text):
{
  "reservation_complete": true/false,
  "needs_human_response": true/false,
  "needs_human_reason": "anledning eller null",
  "is_complaint": true/false,
  "guest_name": "namn eller null",
  "guest_email": "email eller null",
  "guest_phone": "telefon eller null",
  "reservation_date": "datum/veckodag eller null",
  "reservation_time": "tid eller null",
  "party_size": antal eller null,
  "special_requests": "allergier/önskemål eller null"
}`;

  try {
    const responseText = await callGemini(
      [{ role: 'user', parts: [{ text: analysisPrompt }] }],
      { temperature: 0.1, maxOutputTokens: 500 }
    );

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.log('No JSON found in analysis');
      return null;
    }

    const analysis = JSON.parse(jsonMatch[0]);
    console.log('📊 Conversation analysis:', analysis);
    return analysis;

  } catch (err) {
    // Handle rate limit with retry
    if (err.message === 'RATE_LIMITED' && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 1000;
      console.log(`Rate limited, retrying in ${waitTime}ms (attempt ${retryCount + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return analyzeConversation(conversation, aiName, retryCount + 1);
    }

    console.error('Conversation analysis error:', err);
    return null;
  }
}

// ============================================
// DETERMINE FIRED TRIGGERS
// ============================================
export function getFiredTriggers(analysis) {
  const triggers = [];

  if (analysis.reservation_complete && analysis.guest_name && (analysis.guest_email || analysis.guest_phone)) {
    triggers.push('reservation_complete');
  }
  
  if (analysis.is_complaint) {
    triggers.push('is_complaint');
  }
  
  if (analysis.needs_human_response && !analysis.reservation_complete && !analysis.is_complaint) {
    triggers.push('needs_human_response');
  }

  return triggers;
}
