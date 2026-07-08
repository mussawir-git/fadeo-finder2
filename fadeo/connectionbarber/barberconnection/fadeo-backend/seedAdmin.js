// Run once with: node seed/seedAdmin.js
// Creates the demo admin account shown in login.html's credential hint:
//   Email: you@gmail.com   Password: 123@34567
require('dotenv').config();
const bcrypt = require('bcryptjs');
const supabase = require('../config/supabaseClient');

const ADMIN_NAME = 'Admin';
const ADMIN_EMAIL = 'you@gmail.com';
const ADMIN_PASSWORD = '123@34567';

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
