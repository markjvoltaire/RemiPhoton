export interface PendingFlightOfferSummary {
  offer_id: string;
  airline: string;
  flight_number: string;
  price: number;
  currency: string;
  outbound_depart: string;
  outbound_arrive: string;
  return_depart?: string;
  return_arrive?: string;
}

/** Saved when running search_flights so we can refresh stale Duffel offers. */
export interface LastFlightSearchParams {
  origin: string;
  destination: string;
  departure_date: string;
  return_date?: string;
}

export interface LastFlightSearchContext {
  offers: PendingFlightOfferSummary[];
  updated_at: string;
  search_params?: LastFlightSearchParams;
  /** Full `data` object from Duffel POST /air/offer_requests (same shape as API JSON). */
  duffel_raw_offer_request?: Record<string, unknown>;
}

export interface UserProfile {
  id: string;
  phone: string;
  name: string;
  email: string;
  date_of_birth: string; // YYYY-MM-DD
  gender: 'm' | 'f';
  passport_number?: string;
  stripe_customer_id: string | null;
  stripe_spt_id: string | null;
  pending_order_id?: string | null;
  pending_order_amount?: string | null;
  pending_order_currency?: string | null;
  pending_booking_reference?: string | null;
  created_at: string;
  last_flight_search?: LastFlightSearchContext | null;
  /** Last held order: GET /offers + POST /orders payloads until cleared after payment. */
  pending_duffel_order?: Record<string, unknown> | null;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FlightOffer {
  id: string;
  total_amount: string;
  total_currency: string;
  slices: FlightSlice[];
  expires_at: string;
}

export interface FlightSlice {
  origin: string;
  destination: string;
  departure_date: string;
  segments: FlightSegment[];
}

export interface FlightSegment {
  departing_at: string;
  arriving_at: string;
  marketing_carrier_name: string;
  flight_number: string;
  origin: { iata_code: string };
  destination: { iata_code: string };
}

export interface HeldOrder {
  id: string;
  booking_reference: string;
  total_amount: string;
  total_currency: string;
  slices: FlightSlice[];
}
