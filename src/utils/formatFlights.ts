import type { FlightOffer } from '../types.js';

interface Flight {
  airline: string;
  flight_number: string;
  price: number;
  departure_time: string; // HH:MM
  arrival_time: string;   // HH:MM
  return_departure_time?: string; // HH:MM
  return_arrival_time?: string;   // HH:MM
}

function formatTime(hhmm: string): string {
  const [hourStr, min] = hhmm.split(':');
  const hour = parseInt(hourStr, 10);
  const suffix = hour < 12 ? 'a' : 'p';
  const h12 = hour % 12 || 12;
  return `${h12}:${min}${suffix}`;
}

function formatDate(dateStr: string): string {
  // Use noon UTC to avoid date shifting across timezones
  const date = new Date(`${dateStr}T12:00:00Z`);
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function extractHHMM(isoDatetime: string): string {
  // "2026-05-08T05:25:00" → "05:25"
  return isoDatetime.split('T')[1]?.slice(0, 5) ?? '00:00';
}

export function formatFlightOptionsSMS(
  route: { from: string; to: string; date: string; return_date?: string },
  options: Flight[],
): string {
  const sorted = [...options].sort((a, b) => a.price - b.price);
  const arrow = route.return_date ? '↔' : '→';
  const datePart = route.return_date
    ? `${formatDate(route.date)} – ${formatDate(route.return_date)}`
    : formatDate(route.date);
  const header = `${route.from} ${arrow} ${route.to} · ${datePart}`;

  const blocks = sorted.map((f) => {
    const out = `Depart: ${formatTime(f.departure_time)} → ${formatTime(f.arrival_time)}`;
    const ret =
      f.return_departure_time && f.return_arrival_time
        ? `Return: ${formatTime(f.return_departure_time)} → ${formatTime(f.return_arrival_time)}`
        : null;

    return [
      `$${f.price} — ${f.airline} · ${f.flight_number}`,
      out,
      ...(ret ? [ret] : []),
    ].join('\n');
  });

  return [header, ...blocks].join('\n\n');
}

export interface FlightConfirmation {
  airline: string;
  from: string;
  to: string;
  date: string;        // e.g. "May 28"
  departure_time: string; // "20:54"
  arrival_time: string;   // "22:45"
  price: number;
}

export interface HeldOrderSummary {
  from: string;
  to: string;
  depart_date: string; // YYYY-MM-DD
  depart_time: string; // HH:MM
  arrive_time: string; // HH:MM
  return_date?: string; // YYYY-MM-DD
  return_depart_time?: string; // HH:MM
  return_arrive_time?: string; // HH:MM
  airline: string;
  price: number;
}

export function formatHeldOrderConfirmationSMS(summary: HeldOrderSummary): string {
  const arrow = summary.return_date ? '↔' : '→';
  const datePart = summary.return_date
    ? `${formatDate(summary.depart_date)} – ${formatDate(summary.return_date)}`
    : formatDate(summary.depart_date);

  const out = `Depart: ${formatTime(summary.depart_time)} → ${formatTime(summary.arrive_time)}`;
  const ret = summary.return_date && summary.return_depart_time && summary.return_arrive_time
    ? `Return: ${formatTime(summary.return_depart_time)} → ${formatTime(summary.return_arrive_time)}`
    : null;

  return [
    'Confirm this flight',
    '',
    summary.airline,
    `${summary.from} ${arrow} ${summary.to} · ${datePart}`,
    '',
    out,
    ...(ret ? [ret] : []),
    `$${summary.price}`,
    '',
    'Reply HOLD to reserve it',
    'or BOOK to purchase now',
  ].join('\n');
}

export function formatFlightConfirmationSMS(details: FlightConfirmation): string {
  const required = ['airline', 'from', 'to', 'date', 'departure_time', 'arrival_time', 'price'] as const;
  for (const key of required) {
    if (details[key] === undefined || details[key] === null || details[key] === '') {
      throw new Error(`formatFlightConfirmationSMS: missing required field "${key}"`);
    }
  }

  const dep = formatTime(details.departure_time);
  const arr = formatTime(details.arrival_time);

  return [
    'Confirm this flight',
    '',
    details.airline,
    `${details.from} → ${details.to} · ${details.date}`,
    '',
    `${dep} → ${arr}`,
    `$${details.price}`,
    '',
    'Reply HOLD to reserve it',
    'or BOOK to purchase now',
  ].join('\n');
}

export function offersToSMS(offers: FlightOffer[]): string {
  if (offers.length === 0) return 'No flights found for that route and date.';

  const first = offers[0];
  const route = {
    from: first.slices[0].origin,
    to: first.slices[0].destination,
    date: first.slices[0].departure_date,
    return_date: first.slices[1]?.departure_date,
  };

  const flights: Flight[] = offers.map((o) => {
    const outSeg = o.slices[0].segments[0];
    const retSeg = o.slices[1]?.segments[0];
    return {
      airline: outSeg.marketing_carrier_name,
      flight_number: outSeg.flight_number,
      price: Math.round(parseFloat(o.total_amount)),
      departure_time: extractHHMM(outSeg.departing_at),
      arrival_time: extractHHMM(outSeg.arriving_at),
      return_departure_time: retSeg ? extractHHMM(retSeg.departing_at) : undefined,
      return_arrival_time: retSeg ? extractHHMM(retSeg.arriving_at) : undefined,
    };
  });

  return formatFlightOptionsSMS(route, flights);
}
