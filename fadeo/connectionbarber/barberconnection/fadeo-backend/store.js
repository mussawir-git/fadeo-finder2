const bcrypt = require('bcryptjs');
const supabase = require('./supabaseClient');

// This file used to keep everything in plain JS arrays (users = [], shops = []),
// which meant data only lived in server memory and reset every time the
// backend restarted or redeployed. Every function below now reads/writes
// the real Supabase database instead, so both admins/owners see the same
// data no matter which device/browser they're on.

async function ensureSeeded() {
  // No-op now — seeding is handled once via seedAdmin.js, not on every request.
}

// ── Users ──────────────────────────────────────────────
async function findUserByEmail(email) {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .ilike('email', email)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createUser({ name, email, password, role }) {
  const passwordHash = await bcrypt.hash(password, 10);
  const { data, error } = await supabase
    .from('users')
    .insert({ name, email: email.toLowerCase(), password_hash: passwordHash, role })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// ── Shops ──────────────────────────────────────────────
async function createShop({ ownerId, shopName, shopUsername, location }) {
  const { data, error } = await supabase
    .from('shops')
    .insert({
      owner_id: ownerId,
      shop_name: shopName,
      shop_username: shopUsername,
      location,
      status: 'pending',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function getShopByOwnerId(ownerId) {
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getShopByUsername(shopUsername) {
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('shop_username', shopUsername)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getShopById(shopId) {
  const { data, error } = await supabase
    .from('shops')
    .select('*')
    .eq('id', shopId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// Accepts either the shop's real id or its shop_username, same as before.
async function getShopByIdOrUsername(idOrUsername) {
  const byId = await supabase.from('shops').select('*').eq('id', idOrUsername).maybeSingle();
  if (byId.data) return byId.data;

  const byUsername = await supabase
    .from('shops')
    .select('*')
    .eq('shop_username', idOrUsername)
    .maybeSingle();
  if (byUsername.error) throw byUsername.error;
  return byUsername.data;
}

async function listShopsByStatus(status) {
  let query = supabase.from('shops').select('*').order('created_at', { ascending: false });
  if (status) query = query.eq('status', status);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

async function updateShopStatus(shopId, status) {
  const { data, error } = await supabase
    .from('shops')
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq('id', shopId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

// NEW — deletes a shop entirely (also removes its barbers/attendance via
// the "on delete cascade" rules already defined in schema.sql).
async function deleteShop(shopId) {
  const { data, error } = await supabase
    .from('shops')
    .delete()
    .eq('id', shopId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data; // the deleted row, or null if it didn't exist
}

// ── Barbers ────────────────────────────────────────────
async function listBarbersForShop(shopId) {
  const { data, error } = await supabase.from('barbers').select('*').eq('shop_id', shopId);
  if (error) throw error;
  return data;
}

async function getBarberById(barberId) {
  const { data, error } = await supabase
    .from('barbers')
    .select('*')
    .eq('id', barberId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function createBarber({ id, shopId, name, role, specialty, photo, experience, status }) {
  const { data, error } = await supabase
    .from('barbers')
    .insert({
      id: id || `barber-${Date.now()}`,
      shop_id: shopId,
      name,
      role: role || null,
      specialty: specialty || null,
      photo: photo || null,
      experience: experience != null ? Number(experience) : null,
      status: status === 'Away' ? 'Away' : 'Available',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function updateBarber(barberId, updates) {
  const allowedFields = ['name', 'role', 'specialty', 'photo', 'experience', 'status'];
  const patch = { updated_at: new Date().toISOString() };
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      patch[field] = field === 'status'
        ? (updates.status === 'Away' ? 'Away' : 'Available')
        : updates[field];
    }
  }
  const { data, error } = await supabase
    .from('barbers')
    .update(patch)
    .eq('id', barberId)
    .select()
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function deleteBarber(barberId) {
  const { error } = await supabase.from('barbers').delete().eq('id', barberId);
  if (error) throw error;
  return true;
}

// ── Attendance ─────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

async function getAttendanceForShop(shopId, date) {
  const targetDate = date || todayIso();
  const { data, error } = await supabase
    .from('barber_attendance')
    .select('barber_id, status')
    .eq('shop_id', shopId)
    .eq('date', targetDate);
  if (error) throw error;
  const map = {};
  data.forEach((row) => { map[row.barber_id] = row.status; });
  return map;
}

async function setAttendance(barberId, shopId, status, date) {
  const targetDate = date || todayIso();
  const { data, error } = await supabase
    .from('barber_attendance')
    .upsert(
      { barber_id: barberId, shop_id: shopId, date: targetDate, status, updated_at: new Date().toISOString() },
      { onConflict: 'barber_id,date' }
    )
    .select()
    .single();
  if (error) throw error;
  return data;
}

module.exports = {
  ensureSeeded,
  findUserByEmail,
  createUser,
  createShop,
  getShopByOwnerId,
  getShopByUsername,
  getShopById,
  getShopByIdOrUsername,
  listShopsByStatus,
  updateShopStatus,
  deleteShop,
  listBarbersForShop,
  getBarberById,
  createBarber,
  updateBarber,
  deleteBarber,
  getAttendanceForShop,
  setAttendance,
};