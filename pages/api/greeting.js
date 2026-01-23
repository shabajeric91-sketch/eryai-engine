import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { slug, customerId } = req.query;

  if (!slug && !customerId) {
    return res.status(400).json({ error: 'Missing slug or customerId' });
  }

  try {
    // Get customer
    let customerQuery = supabase.from('customers').select('id, name, slug');
    
    if (customerId) {
      customerQuery = customerQuery.eq('id', customerId);
    } else if (slug) {
      customerQuery = customerQuery.eq('slug', slug);
    }

    const { data: customer, error: customerError } = await customerQuery.single();

    if (customerError || !customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Get AI config with greeting
    const { data: aiConfig, error: aiError } = await supabase
      .from('customer_ai_config')
      .select('ai_name, ai_role, greeting')
      .eq('customer_id', customer.id)
      .single();

    if (aiError || !aiConfig) {
      return res.status(404).json({ error: 'AI config not found' });
    }

    return res.status(200).json({
      customerId: customer.id,
      customerName: customer.name,
      slug: customer.slug,
      aiName: aiConfig.ai_name,
      aiRole: aiConfig.ai_role,
      greeting: aiConfig.greeting || `Hej! Jag heter ${aiConfig.ai_name}. Hur kan jag hjälpa dig?`
    });

  } catch (error) {
    console.error('Greeting error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
