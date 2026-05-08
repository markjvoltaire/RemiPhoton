import Anthropic from '@anthropic-ai/sdk';
import { tools } from './tools.js';
import { searchFlights, holdOrder, payForOrderWithBalance } from '../services/duffel.js';
import { chargeViaSPT } from '../services/stripe.js';
import { offersToSMS, formatHeldOrderConfirmationSMS } from '../utils/formatFlights.js';
import { summarizeOffersForContext, formatLastSearchForPrompt } from '../utils/flightSearchContext.js';
import {
  setLastFlightSearch,
  clearLastFlightSearch,
  setPendingOrder,
  clearPendingOrder,
} from '../services/supabase.js';
import { resolveRelativeDates } from '../utils/resolveRelativeDates.js';
import { buildSignupUrl } from '../utils/signupUrl.js';
import { formatDuffelError, isStaleOfferError } from '../utils/duffelErrors.js';
import type { ConversationMessage, UserProfile } from '../types.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `You are Remi, a friendly AI travel concierge that books flights via SMS. Be concise — every response is an SMS.

Today's date is ${new Date().toISOString().split('T')[0]}.

Rules:
- Keep replies short. Max 3 sentences unless listing flight options.
- Plain text only: no Markdown, no asterisks (*), no bold/italics markers, no backticks.
- When presenting flight options, list at most 3, with price, airline, and departure time.
- Always resolve relative dates (e.g. "Friday", "next week") using today's date before calling search_flights.
- Decide whether the user wants a one-way or round-trip flight. If round-trip, collect both departure_date and return_date before calling search_flights.
- If pending flight options are listed in context below, use them: when the user picks an airline or says first/second/third, call hold_flight with the matching offer_id. Do not ask for dates again if they already gave them or if those options already reflect the trip.
- Before taking action on a specific flight, restate the exact flight (airline, time, price) and ask ONE question: "HOLD or BOOK?"
- If user says HOLD: call hold_flight.
- If user says BOOK: call hold_flight first (to get an order_id), then immediately call confirm_booking.
- If a user's request is ambiguous (e.g. no origin city), ask one clarifying question.
- When search_flights returns results, use the "formatted" field as your reply verbatim — do not reformat or paraphrase it. Append one follow-up line: "Which one?" or "Want me to book one?"
- When hold_flight returns, use the "formatted" field as your reply verbatim — do not reformat or paraphrase it.
- For hold_flight, use the offer ID from the "offers" array in the search result.
- Never invent flights, prices, or flight numbers that are not in the latest pending options list from context. If you need another itinerary, call search_flights again.
- Format prices as "$X" not "$X.XX" unless cents matter.
- After a successful booking, give the booking reference and wish them a good flight.`;

type ToolInput = Record<string, unknown>;

async function executeTool(
  toolName: string,
  input: ToolInput,
  user: UserProfile,
): Promise<string> {
  if (toolName === 'search_flights') {
    const offers = await searchFlights({
      origin: input.origin as string,
      destination: input.destination as string,
      departure_date: input.departure_date as string,
      return_date: (input.return_date as string | undefined) || undefined,
      cabin_class: input.cabin_class as 'economy' | undefined,
      adult_count: input.adult_count as number | undefined,
    });
    await setLastFlightSearch(user.id, {
      offers: summarizeOffersForContext(offers),
      updated_at: new Date().toISOString(),
      search_params: {
        origin: input.origin as string,
        destination: input.destination as string,
        departure_date: input.departure_date as string,
        return_date: (input.return_date as string | undefined) || undefined,
      },
    });
    return JSON.stringify({ formatted: offersToSMS(offers), offers });
  }

  if (toolName === 'hold_flight') {
    const offerId = input.offer_id as string;
    const allowedIds = user.last_flight_search?.offers?.map((o) => o.offer_id) ?? [];
    if (allowedIds.length > 0 && !allowedIds.includes(offerId)) {
      return JSON.stringify({
        error: true,
        message:
          'That offer_id is not in the latest search. Call search_flights again with the same route and dates, then call hold_flight only with an offer_id from the new offers list.',
      });
    }

    const nameParts = user.name.trim().split(' ');
    const given_name = nameParts[0];
    const family_name = nameParts.slice(1).join(' ') || nameParts[0];

    const params = user.last_flight_search?.search_params;

    let order;
    try {
      order = await holdOrder(offerId, {
        title: 'mr',
        gender: user.gender,
        given_name,
        family_name,
        date_of_birth: user.date_of_birth,
        email: user.email,
        phone_number: user.phone,
        passport_number: user.passport_number,
      });
    } catch (err) {
      if (params && isStaleOfferError(err)) {
        const offers = await searchFlights({
          origin: params.origin,
          destination: params.destination,
          departure_date: params.departure_date,
          return_date: params.return_date,
        });
        await setLastFlightSearch(user.id, {
          offers: summarizeOffersForContext(offers),
          updated_at: new Date().toISOString(),
          search_params: params,
        });
        return JSON.stringify({
          error: true,
          stale_offer: true,
          formatted: offersToSMS(offers),
          offers,
          message: `Offer expired (${formatDuffelError(err)}). Fresh results are in "formatted". Ask the user to pick again from this list only; then call hold_flight with the new offer_id.`,
        });
      }
      throw err;
    }

    const outSeg = order.slices[0]?.segments[0];
    const retSeg = order.slices[1]?.segments[0];
    const from = order.slices[0]?.origin ?? '';
    const to = order.slices[0]?.destination ?? '';
    const airline = outSeg?.marketing_carrier_name ?? 'Airline';
    const price = Math.round(parseFloat(order.total_amount));

    const confirmation = formatHeldOrderConfirmationSMS({
      from,
      to,
      airline,
      price,
      depart_date: order.slices[0]?.departure_date ?? '',
      depart_time: (outSeg?.departing_at?.split('T')[1]?.slice(0, 5)) ?? '00:00',
      arrive_time: (outSeg?.arriving_at?.split('T')[1]?.slice(0, 5)) ?? '00:00',
      return_date: order.slices[1]?.departure_date,
      return_depart_time: retSeg?.departing_at?.split('T')[1]?.slice(0, 5),
      return_arrive_time: retSeg?.arriving_at?.split('T')[1]?.slice(0, 5),
    });

    await setPendingOrder({
      userId: user.id,
      orderId: order.id,
      bookingReference: order.booking_reference,
      amount: order.total_amount,
      currency: order.total_currency,
    });
    await clearLastFlightSearch(user.id);
    return JSON.stringify({ order, formatted: confirmation });
  }

  if (toolName === 'confirm_booking') {
    if (!user.stripe_spt_id) {
      return JSON.stringify({
        success: false,
        message: `No payment method on file yet. Add your card here: ${buildSignupUrl(user.phone)}`,
      });
    }

    if (!user.pending_order_id) {
      return JSON.stringify({
        success: false,
        message:
          'I can either HOLD or BOOK a flight, but I need a specific option first. Which flight do you want?',
      });
    }

    // If the model doesn't know the order context (because SMS history is plain text),
    // fall back to the last held order persisted on the user record.
    const orderId = (input.order_id as string) || user.pending_order_id;
    const amountStr = (input.amount as string) || user.pending_order_amount;
    const currency = ((input.currency as string) || user.pending_order_currency || '').toLowerCase();

    if (!orderId || !amountStr || !currency) {
      return JSON.stringify({
        success: false,
        message:
          "I don't have a held flight to book yet. Tell me which flight you want and I can hold it first.",
      });
    }

    const amountInCents = Math.round(parseFloat(amountStr) * 100);

    await chargeViaSPT(user.stripe_spt_id, amountInCents, currency);
    await payForOrderWithBalance(orderId, amountStr, currency.toUpperCase());

    await clearLastFlightSearch(user.id);
    await clearPendingOrder(user.id);
    return JSON.stringify({ success: true, message: 'Payment processed and booking confirmed.' });
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

export async function runAgentLoop(
  userMessage: string,
  history: ConversationMessage[],
  user: UserProfile,
): Promise<string> {
  const pending = formatLastSearchForPrompt(user.last_flight_search ?? undefined);
  const todayISO = new Date().toISOString().split('T')[0]!;
  const resolved = resolveRelativeDates(userMessage, todayISO);
  const systemBase = pending ? `${SYSTEM_PROMPT}\n\n${pending}` : SYSTEM_PROMPT;
  const system = resolved.changed
    ? `${systemBase}\n\nRelative date resolution: Interpret the user's last message as: "${resolved.resolvedText}".`
    : systemBase;

  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: 'user', content: userMessage },
  ];

  while (true) {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system,
      tools,
      messages,
    });

    if (response.stop_reason === 'end_turn') {
      const textBlock = response.content.find((b) => b.type === 'text');
      return textBlock?.text ?? '';
    }

    if (response.stop_reason === 'tool_use') {
      const toolUseBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = await Promise.all(
        toolUseBlocks.map(async (block) => {
          try {
            console.log(`[tool] ${block.name} input=${JSON.stringify(block.input)}`);
            const result = await executeTool(block.name, block.input as ToolInput, user);
            console.log(`[tool] ${block.name} ok`);
            return { type: 'tool_result' as const, tool_use_id: block.id, content: result };
          } catch (err) {
            const message = formatDuffelError(err);
            console.error(`[tool] ${block.name} error:`, message);
            return {
              type: 'tool_result' as const,
              tool_use_id: block.id,
              content: `Error: ${message}`,
              is_error: true,
            };
          }
        }),
      );

      messages.push({ role: 'user', content: toolResults });
      continue;
    }

    throw new Error(`Unexpected stop_reason: ${response.stop_reason}`);
  }
}
