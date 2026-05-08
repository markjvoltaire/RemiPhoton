import { Duffel } from '@duffel/api';
import type { FlightOffer, HeldOrder } from '../types.js';

const duffel = new Duffel({ token: process.env.DUFFEL_API_KEY! });

export interface SearchParams {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
  cabin_class?: 'economy' | 'premium_economy' | 'business' | 'first';
  adult_count?: number;
}

export async function searchFlights(params: SearchParams): Promise<FlightOffer[]> {
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

  const offers = (data.offers ?? []).slice(0, 5);

  return offers.map((o) => ({
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

export async function holdOrder(
  offerId: string,
  passenger: PassengerDetails,
): Promise<HeldOrder> {
  const offer = await duffel.offers.get(offerId);
  const passengerId = offer.data.passengers[0].id;

  const { data } = await duffel.orders.create({
    type: 'pay_later',
    selected_offers: [offerId],
    passengers: [
      {
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
      },
    ],
  });

  return {
    id: data.id,
    booking_reference: data.booking_reference,
    total_amount: data.total_amount,
    total_currency: data.total_currency,
    slices: offer.data.slices.map((s) => ({
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
