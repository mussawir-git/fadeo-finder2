const bcrypt = require('bcryptjs');

const users = [];
const shops = [];
const barbers = [];
const attendance = []; // { id, barber_id, shop_id, date: 'YYYY-MM-DD', status }

const defaultUsers = [
  { email: 'mohammedmussawir@gmail.com', password: 'Mussawir@123', role: 'admin', name: 'mussawir' },
  { email: 'karthiarulnathan6@gmail.com', password: 'karthi@57', role: 'admin', name: 'karthi' },
  { email: 'riya@example.com', password: 'Customer@1', role: 'customer', name: 'Riya Sharma' },
  { email: 'arjun@goldenfade.com', password: 'Owner@123', role: 'owner', name: 'Arjun Kumar', shopName: 'Golden Fade Studio', shopUsername: 'goldenfade' },
];

async function seedDefaults() {
  if (users.length > 0) return;

  for (const item of defaultUsers) {
    const passwordHash = await bcrypt.hash(item.password, 10);
    const user = {
      id: `user-${users.length + 1}`,
      name: item.name,
      email: item.email,
      password_hash: passwordHash,
      role: item.role,
    };
    users.push(user);

    if (item.role === 'owner') {
      shops.push({
        id: `shop-${shops.length + 1}`,
        owner_id: user.id,
        shop_name: item.shopName,
        shop_username: item.shopUsername,
        location: 'Andheri West',
        status: 'approved',
        created_at: new Date().toISOString(),
      });
    }
  }
}

async function ensureSeeded() {
  await seedDefaults();
}

function getUsers() {
  return users;
}

function getShops() {
  return shops;
}

async function findUserByEmail(email) {
  await ensureSeeded();
  return users.find((user) => user.email.toLowerCase() === email.toLowerCase()) || null;
}

async function createUser({ name, email, password, role }) {
  await ensureSeeded();
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: `user-${users.length + 1}`,
    name,
    email: email.toLowerCase(),
    password_hash: passwordHash,
    role,
  };
  users.push(user);
  return user;
}

async function createShop({ ownerId, shopName, shopUsername, location }) {
  await ensureSeeded();
  const shop = {
    id: `shop-${shops.length + 1}`,
    owner_id: ownerId,
    shop_name: shopName,
    shop_username: shopUsername,
    location,
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  shops.push(shop);
  return shop;
}

async function getShopByOwnerId(ownerId) {
  await ensureSeeded();
  return shops.find((shop) => shop.owner_id === ownerId) || null;
}

async function getShopByUsername(shopUsername) {
  await ensureSeeded();
  return shops.find((shop) => shop.shop_username === shopUsername) || null;
}

// Accepts either the shop's real id (e.g. "shop-1") or its shop_username
// (e.g. "goldenfade") — the frontend uses both interchangeably depending on
// whether a shop came from the live API or from sample/local data.
async function getShopById(shopId) {
  await ensureSeeded();
  return shops.find((shop) => shop.id === shopId) || null;
}

async function getShopByIdOrUsername(idOrUsername) {
  await ensureSeeded();
  return (
    shops.find((shop) => shop.id === idOrUsername) ||
    shops.find((shop) => shop.shop_username === idOrUsername) ||
    null
  );
}

async function listShopsByStatus(status) {
  await ensureSeeded();
  if (!status) return [...shops];
  return shops.filter((shop) => shop.status === status);
}

async function updateShopStatus(shopId, status) {
  await ensureSeeded();
  const shop = shops.find((item) => item.id === shopId);
  if (!shop) return null;
  shop.status = status;
  shop.reviewed_at = new Date().toISOString();
  return shop;
}

// ── Barbers ────────────────────────────────────────────
async function listBarbersForShop(shopId) {
  await ensureSeeded();
  return barbers.filter((b) => b.shop_id === shopId);
}

async function getBarberById(barberId) {
  await ensureSeeded();
  return barbers.find((b) => b.id === barberId) || null;
}

// Accepts an optional client-generated id so the frontend and backend keep
// using the exact same barber id (important: it's also what lets a barber
// "port" their profile/rating from one shop to another elsewhere in the app).
async function createBarber({ id, shopId, name, role, specialty, photo, experience, status }) {
  await ensureSeeded();
  const barber = {
    id: id || `barber-${Date.now()}`,
    shop_id: shopId,
    name,
    role: role || null,
    specialty: specialty || null,
    photo: photo || null,
    experience: experience != null ? Number(experience) : null,
    status: status === 'Away' ? 'Away' : 'Available',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
  barbers.push(barber);
  return barber;
}

async function updateBarber(barberId, updates) {
  await ensureSeeded();
  const barber = barbers.find((b) => b.id === barberId);
  if (!barber) return null;

  const allowedFields = ['name', 'role', 'specialty', 'photo', 'experience', 'status'];
  for (const field of allowedFields) {
    if (updates[field] !== undefined) {
      barber[field] = field === 'status'
        ? (updates.status === 'Away' ? 'Away' : 'Available')
        : updates[field];
    }
  }
  barber.updated_at = new Date().toISOString();
  return barber;
}

async function deleteBarber(barberId) {
  await ensureSeeded();
  const index = barbers.findIndex((b) => b.id === barberId);
  if (index === -1) return false;
  barbers.splice(index, 1);
  // Attendance rows for a deleted barber are no longer meaningful.
  for (let i = attendance.length - 1; i >= 0; i--) {
    if (attendance[i].barber_id === barberId) attendance.splice(i, 1);
  }
  return true;
}

// ── Attendance ─────────────────────────────────────────
function todayIso() {
  return new Date().toISOString().split('T')[0];
}

// Returns { [barberId]: 'present' | 'leave' | 'half-day' } for every barber
// at a shop on a given date (defaults to today).
async function getAttendanceForShop(shopId, date) {
  await ensureSeeded();
  const targetDate = date || todayIso();
  const map = {};
  attendance
    .filter((a) => a.shop_id === shopId && a.date === targetDate)
    .forEach((a) => { map[a.barber_id] = a.status; });
  return map;
}

async function setAttendance(barberId, shopId, status, date) {
  await ensureSeeded();
  const targetDate = date || todayIso();
  let entry = attendance.find((a) => a.barber_id === barberId && a.date === targetDate);
  if (entry) {
    entry.status = status;
    entry.updated_at = new Date().toISOString();
  } else {
    entry = {
      id: `attendance-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      barber_id: barberId,
      shop_id: shopId,
      date: targetDate,
      status,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    attendance.push(entry);
  }
  return entry;
}

module.exports = {
  ensureSeeded,
  getUsers,
  getShops,
  findUserByEmail,
  createUser,
  createShop,
  getShopByOwnerId,
  getShopByUsername,
  getShopById,
  getShopByIdOrUsername,
  listShopsByStatus,
  updateShopStatus,
  listBarbersForShop,
  getBarberById,
  createBarber,
  updateBarber,
  deleteBarber,
  getAttendanceForShop,
  setAttendance,
};
