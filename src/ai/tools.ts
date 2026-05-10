import type Anthropic from '@anthropic-ai/sdk';

export const tools: Anthropic.Tool[] = [
  {
    name: 'search_flights',
    description:
      'Search for available flights. Returns up to 5 offers sorted by price. Always call this before presenting options to the user.',
    input_schema: {
      type: 'object',
      properties: {
        origin: {
          type: 'string',
          description: 'IATA airport code for departure, e.g. "JFK"',
        },
        destination: {
          type: 'string',
          description: 'IATA airport code for arrival, e.g. "LAX"',
        },
        departure_date: {
          type: 'string',
          description: 'Departure date in YYYY-MM-DD format',
        },
        return_date: {
          type: 'string',
          description:
            'Optional return date in YYYY-MM-DD format. If provided, search a round trip (2 slices). If omitted, search one-way.',
        },
        cabin_class: {
          type: 'string',
          enum: ['economy', 'premium_economy', 'business', 'first'],
          description: 'Cabin class. Defaults to economy.',
        },
        adult_count: {
          type: 'number',
          description: 'Number of adult passengers. Defaults to 1.',
        },
      },
      required: ['origin', 'destination', 'departure_date'],
    },
  },
  {
    name: 'hold_flight',
    description:
      "Reserve a specific flight offer without charging payment, using the user's stored passenger details. Only works when the offer permits pay-later (e.g. Duffel Airways and some legacy carriers). If the offer requires instant payment (e.g. Frontier and most low-cost carriers), this returns { error: true, instant_only: true } and the user should be asked to BOOK instead.",
    input_schema: {
      type: 'object',
      properties: {
        offer_id: {
          type: 'string',
          description: 'The Duffel offer ID to hold',
        },
      },
      required: ['offer_id'],
    },
  },
  {
    name: 'book_flight',
    description:
      "Charge the user's stored payment method and create a fully paid Duffel order in one step (`type: 'instant'` with payment in the same request). Use this whenever the user wants to book and pay now — including any clear affirmative reply (e.g. BOOK, book it, get it, buy it, lock it in, do it, yes, yep, sure, ok, go ahead) given just after a 'HOLD or BOOK?' confirmation question on a specific flight. Works for both pay-later and instant-payment carriers.",
    input_schema: {
      type: 'object',
      properties: {
        offer_id: {
          type: 'string',
          description: 'The Duffel offer ID to book',
        },
      },
      required: ['offer_id'],
    },
  },
  {
    name: 'confirm_booking',
    description:
      'Finalize payment for a previously held (pay_later) order. Charges the user via Stripe and submits the payment to Duffel from balance. Only use when an order is already held via hold_flight; for fresh bookings prefer book_flight.',
    input_schema: {
      type: 'object',
      properties: {
        order_id: {
          type: 'string',
          description: 'The Duffel held order ID to pay for',
        },
        amount: {
          type: 'string',
          description: 'The exact amount to charge (e.g. "278.00")',
        },
        currency: {
          type: 'string',
          description: 'Three-letter currency code (e.g. "usd")',
        },
      },
      required: [],
    },
  },
];
