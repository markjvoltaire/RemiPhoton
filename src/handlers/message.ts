import type { Space, Message } from 'spectrum-ts';

function extractText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(extractText).join('');
  if (content && typeof content === 'object' && 'text' in content) {
    return String((content as { text: unknown }).text ?? '');
  }
  return '';
}
import { getUserByPhone, getConversationHistory, appendMessage } from '../services/supabase.js';
import { markRead } from '../services/imessage.js';
import { runAgentLoop } from '../ai/claude.js';
import { getOnboardingSession, startOnboarding, advanceOnboarding } from '../services/onboarding.js';
import { buildSignupUrl } from '../utils/signupUrl.js';

/** Shown right after passport step; card is collected on the web, not over SMS. */
function buildPostOnboardingHandoff(phone: string): string {
  return `All set! Add your card securely at ${buildSignupUrl(phone)} — I need it on file before I can charge for a booking. Where would you like to fly?`;
}

function sanitizeOutgoingText(text: string): string {
  // Keep SMS plain-text even if the model emits Markdown.
  // 1) unwrap **bold** and *italic*; 2) remove any remaining asterisks.
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\*/g, '');
}

export async function handleMessage(space: Space, message: Message): Promise<void> {
  // Prioritize read receipts before doing any heavier work or replying.
  await markRead(space.id).catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[markRead] failed space=${space.id}: ${msg}`);
  });

  const senderId = message.direction === 'inbound' ? message.sender.id : space.id;

  const text = extractText(message.content);

  console.log(`[msg] space=${space.id} sender=${senderId} content=${JSON.stringify(message.content)} text="${text}"`);

  const user = await getUserByPhone(senderId);

  if (!user) {
    // SMS onboarding (no payment). We keep it simple and deterministic.
    const existing = await getOnboardingSession(senderId);
    if (!existing) {
      await startOnboarding(senderId);
      await message.reply("Hi! I’m Remi. Let’s get you set up. What’s your full name?");
      return;
    }

    const result = await advanceOnboarding(existing, text);
    if (result.kind === 'prompt') {
      await message.reply(result.message);
      return;
    }

    // Persist the handoff so the next inbound message has context (otherwise history is empty
    // and the model may re-introduce itself or misread a city as an origin).
    const newUser = result.user;
    const handoff = buildPostOnboardingHandoff(newUser.phone);
    await appendMessage(newUser.id, 'assistant', handoff);
    await message.reply(handoff);
    return;
  }

  console.log(`[msg] user=${user.id}`);


  const history = await getConversationHistory(user.id);
  await appendMessage(user.id, 'user', text);

  const replyRaw = await runAgentLoop(text, history, user);
  const reply = sanitizeOutgoingText(replyRaw);

  console.log(
    `[agent] space=${space.id} user=${user.id} reply=${JSON.stringify(reply)}${replyRaw !== reply ? ' (sanitized)' : ''}`,
  );

  await appendMessage(user.id, 'assistant', reply);
  await message.reply(reply);
}
