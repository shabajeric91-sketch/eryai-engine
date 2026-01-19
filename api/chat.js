import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// Superadmin email for test notifications
const SUPERADMIN_EMAIL = 'eric@eryai.tech';

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Test-Mode');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Check if test mode
  const isTestMode = req.headers['x-test-mode'] === 'true';
  if (isTestMode) {
    console.log('🧪 TEST MODE ENABLED');
  }

  const { prompt, history, sessionId, customerId, slug } = req.body || {};
  
  if (!prompt || typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'Invalid prompt' });
  }

  // ============================================
  // STEP 1: Identify customer
  // ============================================
  let customer = null;
  
  if (customerId) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('id', customerId)
      .single();
    customer = data;
  } else if (slug) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .eq('slug', slug)
      .single();
    customer = data;
  }
  
  if (!customer) {
    return res.status(404).json({ error: 'Customer not found' });
  }
  
  console.log(`🏢 Customer identified: ${customer.name} (${customer.id})`);

  // ============================================
  // STEP 2: Load AI config
  // ============================================
  const { data: aiConfig, error: configError } = await supabase
    .from('customer_ai_config')
    .select('*')
    .eq('customer_id', customer.id)
    .single();
  
  if (configError || !aiConfig) {
    console.error('No AI config found for customer:', customer.id);
    return res.status(500).json({ error: 'AI configuration not found' });
  }
  
  console.log(`🤖 AI loaded: ${aiConfig.ai_name} (${aiConfig.ai_role})`);

  // ============================================
  // STEP 3: Load actions (behavior rules)
  // ============================================
  const { data: actions } = await supabase
    .from('customer_actions')
    .select('*')
    .eq('customer_id', customer.id)
    .eq('is_active', true)
    .order('priority', { ascending: true });
  
  console.log(`📋 Loaded ${actions?.length || 0} actions`);

  // ============================================
  // STEP 4: Check for triggered actions
  // ============================================
  const promptLower = prompt.toLowerCase();
  const triggeredActions = [];
  
  for (const action of (actions || [])) {
    let triggered = false;
    
    if (action.trigger_type === 'keyword') {
      triggered = promptLower.includes(action.trigger_value.toLowerCase());
    } else if (action.trigger_type === 'regex') {
      try {
        const regex = new RegExp(action.trigger_value, 'i');
        triggered = regex.test(prompt);
      } catch (e) {
        console.error('Invalid regex:', action.trigger_value);
      }
    }
    
    if (triggered) {
      triggeredActions.push(action);
      console.log(`⚡ Action triggered: ${action.action_type} (${action.trigger_value})`);
    }
  }

  // ============================================
  // STEP 5: Create or get session
  // ============================================
  let currentSessionId = sessionId;
  
  if (!currentSessionId) {
    const { data: newSession, error: sessionError } = await supabase
      .from('chat_sessions')
      .insert({
        customer_id: customer.id,
        status: 'active',
        metadata: { 
          source: 'eryai-engine',
          is_test: isTestMode
        }
      })
      .select()
      .single();
    
    if (sessionError) {
      console.error('Failed to create session:', sessionError);
    } else {
      currentSessionId = newSession.id;
      console.log(`📝 New session created: ${currentSessionId}`);
    }
  }

  // ============================================
  // STEP 6: Check if human took over
  // ============================================
  let humanTookOver = false;
  
  if (currentSessionId && history && Array.isArray(history)) {
    const recentHistory = history.slice(-3);
    humanTookOver = recentHistory.some(msg => msg.sender_type === 'human');
    
    if (humanTookOver) {
      console.log('👤 Human took over - AI will not respond');
    }
  }

  // Save user message
  if (currentSessionId) {
    await supabase.from('chat_messages').insert({
      session_id: currentSessionId,
      role: 'user',
      content: prompt,
      sender_type: 'user'
    });
  }

  // If human took over, return empty response
  if (humanTookOver) {
    return res.status(200).json({
      response: '',
      sessionId: currentSessionId,
      humanTookOver: true
    });
  }

  // ============================================
  // STEP 7: Build system prompt with knowledge
  // ============================================
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

  // ============================================
  // STEP 8: Build conversation for Gemini
  // ============================================
  const contents = [];
  
  // System prompt as first user message
  contents.push({
    role: 'user',
    parts: [{ text: systemPrompt }]
  });
  
  // AI greeting
  contents.push({
    role: 'model',
    parts: [{ text: aiConfig.greeting || 'Hej! Hur kan jag hjälpa dig?' }]
  });
  
  // History
  if (history && Array.isArray(history)) {
    for (const msg of history) {
      if (msg.sender_type === 'human') {
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
    parts: [{ text: prompt }]
  });

  // ============================================
  // STEP 9: Call Gemini API
  // ============================================
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    return res.status(500).json({ error: 'Gemini API key missing' });
  }

  try {
    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          generationConfig: {
            temperature: aiConfig.temperature || 0.7,
            maxOutputTokens: aiConfig.max_tokens || 500,
            topP: 0.9
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini error:', geminiResponse.status, errorText);
      return res.status(500).json({ error: 'AI service error' });
    }

    const geminiData = await geminiResponse.json();
    const aiResponse = geminiData.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // ============================================
    // STEP 10: Save AI response
    // ============================================
    if (currentSessionId && aiResponse) {
      await supabase.from('chat_messages').insert({
        session_id: currentSessionId,
        role: 'assistant',
        content: aiResponse,
        sender_type: 'ai'
      });
      
      await supabase
        .from('chat_sessions')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', currentSessionId);
    }

    // ============================================
    // STEP 11: Handle special actions
    // ============================================
    let needsHandoff = false;
    let handoffReason = null;
    
    for (const action of triggeredActions) {
      if (action.action_type === 'handoff') {
        needsHandoff = true;
        handoffReason = action.action_config?.reason || 'customer_request';
        console.log(`🚨 Handoff triggered: ${handoffReason}`);
      }
    }
    
    // Check if AI response indicates handoff
    const sofiaOffersHandoff = /(kopplar dig|skickar vidare|personalen återkommer|dröj kvar)/i.test(aiResponse);
    if (sofiaOffersHandoff) {
      needsHandoff = true;
      handoffReason = handoffReason || 'ai_offered';
    }

    // Update session if handoff needed
    if (needsHandoff && currentSessionId) {
      await supabase
        .from('chat_sessions')
        .update({ needs_human: true })
        .eq('id', currentSessionId);
      
      // TODO: Send notification email (implement later)
      console.log(`📧 Would send handoff notification (reason: ${handoffReason})`);
    }

    // ============================================
    // STEP 12: Return response
    // ============================================
    return res.status(200).json({
      response: aiResponse,
      sessionId: currentSessionId,
      customerId: customer.id,
      customerName: customer.name,
      aiName: aiConfig.ai_name,
      triggeredActions: triggeredActions.map(a => a.action_type),
      needsHandoff
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
}
