import { Duffel } from '@duffel/api';
import type { FlightOffer, HeldOrder } from '../types.js';

const duffel = new Duffel({ token: process.env.DUFFEL_API_KEY! });

/** Clone Duffel `data` payloads for JSONB storage / logs without mutation surprises. */
export function serializeDuffelData(data: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(data)) as Record<string, unknown>;
}

/** Full API bodies for Render/host logs (lines can be large). */
function logDuffelPayload(tag: string, payload: Record<string, unknown>): void {
  try {
    console.log(`[duffel] ${tag}`, JSON.stringify(payload));
  } catch {
    console.log(`[duffel] ${tag}`, '(serialize failed)');
  }
}

/**
 * Thrown when callers attempt `pay_later` on an offer that Duffel only
 * permits via `instant` payment (most low-cost carriers, e.g. Frontier).
 */
export class OfferRequiresInstantPaymentError extends Error {
  readonly offerId: string;
  readonly amount: string;
  readonly currency: string;
  constructor(offerId: string, amount: string, currency: string) {
    super(`Offer ${offerId} requires instant payment and cannot be held`);
    this.name = 'OfferRequiresInstantPaymentError';
    this.offerId = offerId;
    this.amount = amount;
    this.currency = currency;
  }
}

export interface SearchParams {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  cabin_class?: 'economy' | 'premium_economy' | 'business' | 'first';
  adult_count?: number;
}

export interface SearchFlightsResult {
  offers: FlightOffer[];
  /** Full `data` from POST /air/offer_requests (includes nested offers list). */
  rawOfferRequest: Record<string, unknown>;
}

export async function searchFlights(params: SearchParams): Promise<SearchFlightsResult> {
  const slices = [
    {
      origin: params.origin,
      destination: params.destination,
      departure_date: params.departure_date,
      arrival_time: null,
      departure_time: null,
    },
    ...(params.return_date
      ? [
          {
            origin: params.destination,
            destination: params.origin,
            departure_date: params.return_date,
            arrival_time: null,
            departure_time: null,
          },
        ]
      : []),
  ];

  const { data } = await duffel.offerRequests.create({
    slices,
    passengers: Array.from({ length: params.adult_count ?? 1 }, () => ({ type: 'adult' as const })),
    cabin_class: params.cabin_class ?? 'economy',
    return_offers: true,
  });

  const rawOfferRequest = serializeDuffelData(data);
  logDuffelPayload('POST /air/offer_requests data', rawOfferRequest);

  const offers = (data.offers ?? []).slice(0, 5);

  const mapped: FlightOffer[] = offers.map((o) => ({
    id: o.id,
    total_amount: o.total_amount,
    total_currency: o.total_currency,
    expires_at: o.expires_at,
    slices: o.slices.map((s) => ({
      origin: s.origin.iata_code ?? '',
      destination: s.destination.iata_code ?? '',
      departure_date: s.segments[0]?.departing_at?.split('T')[0] ?? params.departure_date,
      segments: s.segments.map((seg) => ({
        departing_at: seg.departing_at,
        arriving_at: seg.arriving_at,
        marketing_carrier_name: seg.marketing_carrier.name,
        flight_number: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
        origin: { iata_code: seg.origin.iata_code ?? '' },
        destination: { iata_code: seg.destination.iata_code ?? '' },
      })),
    })),
  }));

  return { offers: mapped, rawOfferRequest };
}

export interface PassengerDetails {
  title: 'mr' | 'ms' | 'mrs' | 'miss' | 'dr';
  gender: 'm' | 'f';
  given_name: string;
  family_name: string;
  date_of_birth: string;
  email: string;
  phone_number: string;
  passport_number?: string;
}

export interface HoldOrderResult {
  order: HeldOrder;
  /** GET /air/offers/:id → response `data` */
  rawOfferGet: Record<string, unknown>;
  /** POST /air/orders → response `data` */
  rawOrderCreate: Record<string, unknown>;
}

interface OfferDetails {
  /** Raw `offer.data` (typed loosely to keep the SDK details encapsulated). */
  offer: Awaited<ReturnType<typeof duffel.offers.get>>['data'];
  passengerId: string;
  amount: string;
  currency: string;
  requiresInstantPayment: boolean;
}

async function fetchOfferDetails(offerId: string): Promise<OfferDetails> {
  const offer = await duffel.offers.get(offerId);
  const data = offer.data;
  return {
    offer: data,
    passengerId: data.passengers[0].id,
    amount: data.total_amount,
    currency: data.total_currency,
    requiresInstantPayment: data.payment_requirements?.requires_instant_payment ?? false,
  };
}

export interface OfferPricing {
  /** Exact decimal amount as a string, e.g. "387.42" — never rounded. */
  amount: string;
  /** ISO currency code in the case Duffel returns it (e.g. "USD"). */
  currency: string;
  requiresInstantPayment: boolean;
}

/**
 * Fetch just the price/currency for an offer. Cheap wrapper used by the
 * book_flight handler so it can charge Stripe with the exact decimal amount
 * before creating the Duffel order.
 */
export async function getOfferPricing(offerId: string): Promise<OfferPricing> {
  const details = await fetchOfferDetails(offerId);
  return {
    amount: details.amount,
    currency: details.currency,
    requiresInstantPayment: details.requiresInstantPayment,
  };
}

function buildPassengerPayload(passengerId: string, passenger: PassengerDetails) {
  return {
    id: passengerId,
    title: passenger.title,
    gender: passenger.gender,
    given_name: passenger.given_name,
    family_name: passenger.family_name,
    born_on: passenger.date_of_birth,
    email: passenger.email,
    phone_number: passenger.phone_number,
    ...(passenger.passport_number
      ? {
          identity_documents: [
            {
              type: 'passport' as const,
              unique_identifier: passenger.passport_number,
              expires_on: '2030-01-01',
              issuing_country_code: 'US',
            },
          ],
        }
      : {}),
  };
}

function buildHeldOrder(
  data: Awaited<ReturnType<typeof duffel.orders.create>>['data'],
  offerData: OfferDetails['offer'],
): HeldOrder {
  return {
    id: data.id,
    booking_reference: data.booking_reference,
    total_amount: data.total_amount,
    total_currency: data.total_currency,
    slices: offerData.slices.map((s) => ({
      origin: s.origin.iata_code ?? '',
      destination: s.destination.iata_code ?? '',
      departure_date: s.segments[0]?.departing_at?.split('T')[0] ?? '',
      segments: s.segments.map((seg) => ({
        departing_at: seg.departing_at,
        arriving_at: seg.arriving_at,
        marketing_carrier_name: seg.marketing_carrier.name,
        flight_number: `${seg.marketing_carrier.iata_code}${seg.marketing_carrier_flight_number}`,
        origin: { iata_code: seg.origin.iata_code ?? '' },
        destination: { iata_code: seg.destination.iata_code ?? '' },
      })),
    })),
  };
}

/**
 * Reserve a Duffel offer with `pay_later`. Throws
 * {@link OfferRequiresInstantPaymentError} if the offer doesn't allow it,
 * so callers can surface a friendly "this offer can only be BOOKed" message
 * instead of the raw 422 from Duffel.
 */
export async function holdOrder(
  offerId: string,
  passenger: PassengerDetails,
): Promise<HoldOrderResult> {
  const details = await fetchOfferDetails(offerId);
  const rawOfferGet = serializeDuffelData(details.offer);
  logDuffelPayload(`GET /air/offers/${offerId} data`, rawOfferGet);

  if (details.requiresInstantPayment) {
    throw new OfferRequiresInstantPaymentError(offerId, details.amount, details.currency);
  }

  const { data } = await duffel.orders.create({
    type: 'pay_later',
    selected_offers: [offerId],
    passengers: [buildPassengerPayload(details.passengerId, passenger)],
  });

  const rawOrderCreate = serializeDuffelData(data);
  logDuffelPayload('POST /air/orders data (pay_later)', rawOrderCreate);

  return {
    order: buildHeldOrder(data, details.offer),
    rawOfferGet,
    rawOrderCreate,
  };
}

/**
 * Create a fully paid Duffel order in one request: `type: 'instant'` with
 * `payments: [{ type: 'balance', amount, currency }]`. Used for the BOOK
 * flow, including instant-payment carriers like Frontier.
 *
 * Caller is responsible for collecting money from the end user (e.g. via
 * Stripe) BEFORE calling this and refunding on failure — Duffel here pulls
 * funds from the merchant's pre-funded Duffel balance.
 */
export async function bookOrderInstant(
  offerId: string,
  passenger: PassengerDetails,
): Promise<HoldOrderResult> {
  const details = await fetchOfferDetails(offerId);
  const rawOfferGet = serializeDuffelData(details.offer);
  logDuffelPayload(`GET /air/offers/${offerId} data`, rawOfferGet);

  const { data } = await duffel.orders.create({
    type: 'instant',
    selected_offers: [offerId],
    passengers: [buildPassengerPayload(details.passengerId, passenger)],
    payments: [
      {
        type: 'balance',
        amount: details.amount,
        currency: details.currency,
      },
    ],
  });

  const rawOrderCreate = serializeDuffelData(data);
  logDuffelPayload('POST /air/orders data (instant)', rawOrderCreate);

  return {
    order: buildHeldOrder(data, details.offer),
    rawOfferGet,
    rawOrderCreate,
  };
}

export async function payForOrderWithBalance(
  orderId: string,
  amount: string,
  currency: string,
): Promise<void> {
  await duffel.payments.create({
    order_id: orderId,
    payment: {
      type: 'balance',
      amount,
      currency,
    },
  });
}
