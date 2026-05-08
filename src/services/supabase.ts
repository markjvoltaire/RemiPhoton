import { createClient } from '@supabase/supabase-js';
import type { ConversationMessage, LastFlightSearchContext, UserProfile } from '../types.js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

export async function getUserByPhone(phone: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('phone', phone)
    .single();

  if (error) return null;
  return data as UserProfile;
}

export async function getConversationHistory(userId: string): Promise<ConversationMessage[]> {
  const { data, error } = await supabase
    .from('conversations')
    .select('role, content')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(40);

  if (error || !data) return [];
  // We fetch newest-first for correctness with `.limit`, then reverse so the model
  // receives chronological order (oldest -> newest).
  return (data as ConversationMessage[]).slice().reverse();
}

export async function appendMessage(
  userId: string,
  role: 'user' | 'assistant',
  content: string,
): Promise<void> {
  await supabase.from('conversations').insert({ user_id: userId, role, content });
}

export async function setLastFlightSearch(
  userId: string,
  ctx: LastFlightSearchContext,
): Promise<void> {
  await supabase.from('users').update({ last_flight_search: ctx }).eq('id', userId);
}

export async function clearLastFlightSearch(userId: string): Promise<void> {
  await supabase.from('users').update({ last_flight_search: null }).eq('id', userId);
}

export async function setPendingOrder(params: {
  userId: string;
  orderId: string;
  bookingReference: string;
  amount: string;
  currency: string;
}): Promise<void> {
  await supabase
    .from('users')
    .update({
      pending_order_id: params.orderId,
      pending_booking_reference: params.bookingReference,
      pending_order_amount: params.amount,
      pending_order_currency: params.currency,
    })
    .eq('id', params.userId);
}

export async function clearPendingOrder(userId: string): Promise<void> {
  await supabase
    .from('users')
    .update({
      pending_order_id: null,
      pending_booking_reference: null,
      pending_order_amount: null,
      pending_order_currency: null,
    })
    .eq('id', userId);
}
