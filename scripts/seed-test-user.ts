import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const TEST_USER = {
  phone: '+17862876921',
  name: 'Mark Voltaire',
  email: 'markvoltairedev@gmail.com',
  date_of_birth: '1990-01-01',
  gender: 'm',
  passport_number: null,
  stripe_customer_id: 'cus_test_placeholder',
  stripe_spt_id: 'pm_test_placeholder',
};

const { error } = await supabase
  .from('users')
  .upsert(TEST_USER, { onConflict: 'phone' });

if (error) {
  console.error('Seed failed:', error.message);
  process.exit(1);
}

console.log(`Test user seeded for ${TEST_USER.phone}`);
