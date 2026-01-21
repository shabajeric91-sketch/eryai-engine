import { getEmailTemplate } from '../db/supabase.js';

const RESEND_API_URL = 'https://api.resend.com/emails';
const SUPERADMIN_EMAIL = 'eric@eryai.tech';

// ============================================
// SEND EMAIL VIA RESEND
// ============================================
async function sendEmail({ from, to, replyTo, subject, html }) {
  const RESEND_API_KEY = process.env.RESEND_API_KEY;
  
  if (!RESEND_API_KEY) {
    console.log('RESEND_API_KEY not set, skipping email');
    return { success: false, error: 'No API key' };
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: replyTo,
        subject,
        html
      })
    });

    const result = await response.json();

    if (response.ok) {
      console.log(`✅ Email sent: ${result.id} (to: ${to})`);
      return { success: true, id: result.id };
    } else {
      console.error('Resend API error:', response.status, result);
      return { success: false, error: result };
    }
  } catch (err) {
    console.error('Failed to send email:', err);
    return { success: false, error: err.message };
  }
}

// ============================================
// PROCESS TEMPLATE
// ============================================
function processTemplate(template, vars) {
  let subject = template.subject;
  let html = template.html_body;

  // Replace {{variable}} placeholders
  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`{{${key}}}`, 'g');
    subject = subject.replace(regex, value || '');
    html = html.replace(regex, value || '');
  }

  // Handle conditional sections {{#key}}...{{/key}}
  html = html.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (match, key, content) => {
    return vars[key] ? content : '';
  });

  return { subject, html };
}

// ============================================
// SEND STAFF EMAIL
// ============================================
export async function sendStaffEmail({ customer, aiConfig, analysisConfig, analysis, sessionId, templateName, isTestMode }) {
  const template = await getEmailTemplate(customer.id, templateName);
  
  if (!template) {
    console.error(`Email template not found: ${templateName}`);
    return { success: false, error: 'Template not found' };
  }

  const guestContact = analysis.guest_email || analysis.guest_phone || 'Ej angiven';
  
  const vars = {
    ai_name: aiConfig.ai_name,
    customer_name: customer.name,
    guest_name: analysis.guest_name || 'Okänd gäst',
    guest_contact: guestContact,
    session_id: sessionId,
    reservation_date: analysis.reservation_date || '',
    reservation_time: analysis.reservation_time || '',
    party_size: analysis.party_size || '',
    special_requests: analysis.special_requests || '',
    summary: analysis.needs_human_reason || 'Gästen behöver hjälp'
  };

  const { subject, html } = processTemplate(template, vars);
  
  const toEmail = isTestMode ? SUPERADMIN_EMAIL : (analysisConfig?.staff_email || SUPERADMIN_EMAIL);
  const testPrefix = isTestMode ? '[TEST] ' : '';

  return sendEmail({
    from: `${aiConfig.ai_name} <${analysisConfig?.from_email || 'sofia@eryai.tech'}>`,
    to: toEmail,
    replyTo: customer.metadata?.reply_to_email,
    subject: testPrefix + subject,
    html
  });
}

// ============================================
// SEND GUEST EMAIL
// ============================================
export async function sendGuestEmail({ customer, aiConfig, analysisConfig, analysis, templateName, isTestMode }) {
  if (!analysis.guest_email) {
    console.log('No guest email, skipping guest notification');
    return { success: false, error: 'No guest email' };
  }

  const template = await getEmailTemplate(customer.id, templateName);
  
  if (!template) {
    console.error(`Email template not found: ${templateName}`);
    return { success: false, error: 'Template not found' };
  }

  const vars = {
    ai_name: aiConfig.ai_name,
    customer_name: customer.name,
    customer_tagline: customer.metadata?.tagline || '',
    customer_address: customer.metadata?.address || '',
    customer_phone: customer.metadata?.phone || '',
    guest_name: analysis.guest_name || 'Gäst',
    reservation_date: analysis.reservation_date || '',
    reservation_time: analysis.reservation_time || '',
    party_size: analysis.party_size || '',
    special_requests: analysis.special_requests || ''
  };

  const { subject, html } = processTemplate(template, vars);
  
  const toEmail = isTestMode ? SUPERADMIN_EMAIL : analysis.guest_email;
  const testPrefix = isTestMode ? '[TEST GUEST EMAIL] ' : '';

  return sendEmail({
    from: `${customer.name} <${analysisConfig?.from_email || 'sofia@eryai.tech'}>`,
    to: toEmail,
    replyTo: customer.metadata?.reply_to_email,
    subject: testPrefix + subject,
    html
  });
}

// ============================================
// SEND SUPERADMIN SECURITY ALERT
// ============================================
export async function sendSuperadminAlert({ to, subject, customerName, sessionId, reason, prompt, isTestMode }) {
  const DASHBOARD_URL = 'https://dashboard.eryai.tech';
  const sessionUrl = `${DASHBOARD_URL}/dashboard/session/${sessionId}`;
  
  const emailSubject = isTestMode ? `[TEST] ${subject}` : subject;
  const recipientEmail = isTestMode ? SUPERADMIN_EMAIL : to;
  const timestamp = new Date().toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' });

  return sendEmail({
    from: 'EryAI Security <security@eryai.tech>',
    to: recipientEmail,
    subject: emailSubject,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #fee2e2; border: 2px solid #dc2626; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h2 style="color: #dc2626; margin: 0 0 10px 0;">🚨 Security Alert</h2>
          <p style="color: #991b1b; margin: 0;">Suspicious activity detected on ${customerName}</p>
        </div>

        <div style="background: #f9fafb; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <h3 style="margin-top: 0;">Details</h3>
          <p><strong>Time:</strong> ${timestamp}</p>
          <p><strong>Customer:</strong> ${customerName}</p>
          <p><strong>Reason:</strong> <span style="background: #fef3c7; padding: 2px 8px; border-radius: 4px;">${reason}</span></p>
          <p><strong>Session ID:</strong> <code>${sessionId}</code></p>
        </div>

        <div style="background: #fef2f2; padding: 15px; border-radius: 8px; margin-bottom: 20px;">
          <h4 style="margin: 0 0 10px 0; color: #991b1b;">Suspicious Message:</h4>
          <p style="margin: 0; font-style: italic;">"${prompt}"</p>
        </div>

        <div style="text-align: center;">
          <a href="${sessionUrl}" style="background: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            View Session
          </a>
        </div>
      </div>
    `
  });
}
