import {
  getCustomerById,
  getCustomerBySlug,
  getAiConfig,
  getAnalysisConfig,
  getActiveActions,
  getSession,
  createSession,
  updateSession,
  updateSessionMetadata,
  saveMessage
} from '../db/supabase.js';

import { callGemini, buildChatContents, buildSystemPrompt } from '../ai/gemini.js';
import { shouldRunAnalysis, analyzeConversation, getFiredTriggers } from '../ai/analysis.js';
import { checkKeywordTriggers, executeActionsForTrigger } from '../actions/executor.js';
import { pushNewGuestMessage } from '../notifications/push.js';
import { sendSuperadminAlert } from '../notifications/email.js';

const SUPERADMIN_EMAIL = 'eric@eryai.tech';

// ============================================
// MAIN CHAT HANDLER
// ============================================
export async function handleChat({ prompt, history, sessionId, customerId, slug, isTestMode, suspicious, suspiciousReason }) {
  try {
    // STEP 1: Identify customer
    let customer = null;
    
    if (slug) {
      customer = await getCustomerBySlug(slug);
    } else if (customerId) {
      customer = await getCustomerById(customerId);
    }

    if (!customer) {
      return { error: 'Customer not found', status: 404 };
    }

    console.log(`🏢 Customer identified: ${customer.name} (${customer.id})`);

    // STEP 2: Load AI config and actions
    const aiConfig = await getAiConfig(customer.id);
    const analysisConfig = await getAnalysisConfig(customer.id);
    const actions = await getActiveActions(customer.id);

    if (!aiConfig) {
      return { error: 'AI config not found', status: 404 };
    }

    console.log(`🤖 AI loaded: ${aiConfig.ai_name} (${aiConfig.ai_role || 'assistant'})`);
    console.log(`📋 Loaded ${actions?.length || 0} actions`);

    // STEP 3: Handle session
    let currentSessionId = sessionId;
    let session = null;

    if (sessionId) {
      session = await getSession(sessionId);
    }

    if (!session) {
      session = await createSession(customer.id, {});
      currentSessionId = session.id;
      console.log(`📝 New session created: ${currentSessionId}`);
    }

    // STEP 3.5: Handle suspicious activity
    if (suspicious && currentSessionId) {
      console.warn(`🚨 [SECURITY] Suspicious activity detected!`);
      console.warn(`Session: ${currentSessionId}`);
      console.warn(`Reason: ${suspiciousReason}`);
      console.warn(`Prompt: "${prompt.substring(0, 50)}..."`);

      // Flag session as suspicious and route to superadmin
      await updateSession(currentSessionId, {
        suspicious: true,
        suspicious_reason: suspiciousReason,
        routed_to_superadmin: true
      });

      // Send security alert email to superadmin
      try {
        await sendSuperadminAlert({
          to: SUPERADMIN_EMAIL,
          subject: `🚨 [SECURITY] Suspicious Activity - ${customer.name}`,
          customerName: customer.name,
          sessionId: currentSessionId,
          reason: suspiciousReason,
          prompt: prompt,
          isTestMode
        });
        console.log('✅ Security alert email sent to superadmin');
      } catch (emailError) {
        console.error('❌ Failed to send security alert:', emailError.message);
      }
    }

    // STEP 4: Build system prompt and chat contents
    const systemPrompt = buildSystemPrompt(aiConfig, session?.metadata);
    const chatContents = buildChatContents(history || [], prompt);

    // STEP 5: Check keyword triggers BEFORE AI response
    const keywordResults = checkKeywordTriggers(prompt, actions);

    // STEP 6: Call Gemini
    const aiResponse = await callGemini(systemPrompt, chatContents);

    if (!aiResponse) {
      return { error: 'AI failed to respond', status: 500 };
    }

    // STEP 7: Save messages
    await saveMessage(currentSessionId, 'user', prompt);
    await saveMessage(currentSessionId, 'assistant', aiResponse);

    // Update session timestamp
    await updateSession(currentSessionId, {
      updated_at: new Date().toISOString()
    });

    // STEP 8: Skip analysis and notifications for suspicious sessions
    // Superadmin already notified - don't spam the customer
    if (suspicious) {
      console.log('⏭️ Skipping analysis for suspicious session - superadmin already notified');
      return {
        response: aiResponse,
        sessionId: currentSessionId,
        customer: customer.name,
        suspicious: true
      };
    }

    // STEP 9: Run conversation analysis (only for non-suspicious sessions)
    console.log('🔄 Starting analysis step...');
    
    if (analysisConfig) {
      const runAnalysis = shouldRunAnalysis(aiResponse, prompt, session?.metadata);
      console.log(`🔄 runAnalysis called`);
      console.log(`🔍 Analysis triggers:`, runAnalysis.triggers);
      console.log(`🔍 Should run: ${runAnalysis.shouldRun}`);

      if (runAnalysis.shouldRun) {
        console.log('🧠 Calling Gemini for analysis...');
        
        const fullHistory = [
          ...(history || []),
          { role: 'user', content: prompt },
          { role: 'assistant', content: aiResponse }
        ];

        const analysisResult = await analyzeConversation(fullHistory, analysisConfig);
        console.log('📊 Conversation analysis:', analysisResult);

        // Update session metadata with analysis results
        if (analysisResult) {
          const metadataUpdate = {};
          
          if (analysisResult.guest_name) metadataUpdate.guest_name = analysisResult.guest_name;
          if (analysisResult.guest_email) metadataUpdate.guest_email = analysisResult.guest_email;
          if (analysisResult.guest_phone) metadataUpdate.guest_phone = analysisResult.guest_phone;
          if (analysisResult.reservation_date) metadataUpdate.reservation_date = analysisResult.reservation_date;
          if (analysisResult.reservation_time) metadataUpdate.reservation_time = analysisResult.reservation_time;
          if (analysisResult.party_size) metadataUpdate.party_size = analysisResult.party_size;
          if (analysisResult.special_requests) metadataUpdate.special_requests = analysisResult.special_requests;

          if (Object.keys(metadataUpdate).length > 0) {
            await updateSessionMetadata(currentSessionId, metadataUpdate);
          }

          // Get fired triggers and execute actions
          const firedTriggers = getFiredTriggers(analysisResult);
          console.log('🎯 Fired triggers:', firedTriggers);

          for (const trigger of firedTriggers) {
            console.log(`⚙️ Executing actions for trigger: ${trigger}`);
            await executeActionsForTrigger(trigger, actions, {
              customer,
              session: { ...session, id: currentSessionId },
              analysisResult,
              aiConfig,
              isTestMode
            });
          }
        }
      }
    }

    // STEP 10: Send push notification for new guest message (non-suspicious only)
    try {
      await pushNewGuestMessage(customer.id, currentSessionId, prompt);
    } catch (pushError) {
      console.error('❌ Push notification failed:', pushError.message);
    }

    console.log('✅ Analysis complete');

    return {
      response: aiResponse,
      sessionId: currentSessionId,
      customer: customer.name,
      suspicious: false
    };

  } catch (error) {
    console.error('❌ Chat error:', error);
    return { error: error.message, status: 500 };
  }
}
