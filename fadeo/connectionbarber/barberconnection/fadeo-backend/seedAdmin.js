// Run once with: node seedAdmin.js
// Creates ONE shared admin account that both you and your teammate log into.
// Since both of you use the same email/password AND the same Supabase
// database, whichever one of you approves/rejects/deletes a shop, the other
// will see that change immediately (no separate local copies anymore).

require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('./supabaseClient'); // fixed path — was '../config/supabaseClient'

const ADMIN_NAME = 'Fadeo Admin';
const ADMIN_EMAIL = 'admin@fadeofinder.com'; // change this to whatever email you both want to share
const ADMIN_PASSWORD = 'ChangeThis@123';     // change this to a real shared password

async function seedAdmin() {
  const { data: existing, error: lookupErr } = await supabase
    .from('users')
    .select('id')
    .eq('email', ADMIN_EMAIL)
    .maybeSingle();

  if (lookupErr) throw lookupErr;

  if (existing) {
    console.log('Admin account already exists. Nothing to do.');
    return;
  }

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);

  const { error: insertErr } = await supabase
    .from('users')
    .insert({ name: ADMIN_NAME, email: ADMIN_EMAIL, password_hash: passwordHash, role: 'admin' });

  if (insertErr) throw insertErr;

  console.log(`Admin account created: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
}

seedAdmin()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Failed to seed admin:', err.message);
    process.exit(1);
  });