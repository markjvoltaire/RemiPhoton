import type { FlightOffer, LastFlightSearchContext, PendingFlightOfferSummary } from '../types.js';

function extractHHMM(isoDatetime: string): string {
  return isoDatetime.split('T')[1]?.slice(0, 5) ?? '00:00';
}

export function summarizeOffersForContext(offers: FlightOffer[]): PendingFlightOfferSummary[] {
  return offers.map((o) => {
    const out = o.slices[0]?.segments[0];
    const ret = o.slices[1]?.segments[0];
    return {
      offer_id: o.id,
      airline: out?.marketing_carrier_name ?? '',
      flight_number: out?.flight_number ?? '',
      price: Math.round(parseFloat(o.total_amount)),
      currency: o.total_currency,
      outbound_depart: extractHHMM(out?.departing_at ?? ''),
      outbound_arrive: extractHHMM(out?.arriving_at ?? ''),
      return_depart: ret ? extractHHMM(ret.departing_at) : undefined,
      return_arrive: ret ? extractHHMM(ret.arriving_at) : undefined,
    };
  });
}

export function formatLastSearchForPrompt(ctx: LastFlightSearchContext | null | undefined): string {
  if (!ctx?.offers?.length) return '';

  const lines = ctx.offers.map((o, idx) => {
    const ret =
      o.return_depart && o.return_arrive
        ? ` | return ${o.return_depart}-${o.return_arrive}`
        : '';
    return `${idx + 1}. offer_id=${o.offer_id} ${o.airline} ${o.flight_number} $${o.price} ${o.outbound_depart}-${o.outbound_arrive}${ret}`;
  });

  return [
    'Latest search — pending options (use these exact offer_id values for hold_flight):',
    ...lines,
    'If the user names an airline, flight number, or says first/second/third, pick the matching row.',
    'Do not ask for departure or return dates again if the user already gave them or if the options above already reflect those dates.',
  ].join('\n');
}
