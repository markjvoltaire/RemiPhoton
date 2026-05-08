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
      'Hold a specific flight offer using the user\'s stored passenger details. This reserves the seat without charging payment. Call this only after the user has confirmed they want to book a specific flight.',
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
    name: 'confirm_booking',
    description:
      'Finalize payment and confirm a held order. Issues a single-use virtual card via Stripe Issuing and submits payment to Duffel. Call this only after the user has explicitly confirmed the booking.',
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
      required: ['order_id', 'amount', 'currency'],
    },
  },
];
