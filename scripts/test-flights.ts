import 'dotenv/config';
import { searchFlights } from '../src/services/duffel.js';

const { offers } = await searchFlights({
  origin: 'LHR',
  destination: 'JFK',
  departure_date: '2025-07-01',
  cabin_class: 'economy',
  adult_count: 1,
});

if (offers.length === 0) {
  console.log('No offers returned.');
} else {
  for (const offer of offers) {
    const seg = offer.slices[0].segments[0];
    console.log(
      `${offer.id} | ${seg.marketing_carrier_name} ${seg.flight_number} | ${seg.departing_at} → ${seg.arriving_at} | $${offer.total_amount} ${offer.total_currency}`,
    );
  }
}
