const store = require('./store');

const VALID_ATTENDANCE_STATUSES = ['present', 'leave', 'half-day'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Confirms the logged-in owner actually owns the shop identified by :shopId
// (accepts either the shop's real id or its shop_username). Returns the shop
// record on success, or null and writes the appropriate error response.
async function requireOwnedShop(req, res, shopIdParam) {
  const shop = await store.getShopByIdOrUsername(shopIdParam);
  if (!shop) {
    res.status(404).json({ message: 'Shop not found.' });
    return null;
  }
  if (shop.owner_id !== req.user.id) {
    res.status(403).json({ message: 'You do not have permission to manage this shop.' });
    return null;
  }
  return shop;
}

// ── GET /api/shops/:shopId/barbers ── (public — marketplace listing)
async function listBarbers(req, res, next) {
  try {
    const shop = await store.getShopByIdOrUsername(req.params.shopId);
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    const barbers = await store.listBarbersForShop(shop.id);
    res.status(200).json({ barbers });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/shops/:shopId/barbers ── (owner only, own shop)
async function createBarber(req, res, next) {
  try {
    const shop = await requireOwnedShop(req, res, req.params.shopId);
    if (!shop) return;

    const { id, name, role, specialty, photo, experience, status } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ message: 'Barber name is required.' });
    }

    const barber = await store.createBarber({
      id, shopId: shop.id, name: name.trim(), role, specialty, photo, experience, status,
    });

    res.status(201).json({ message: `${barber.name} added.`, barber });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/barbers/:id ── (owner only, own shop)
async function updateBarber(req, res, next) {
  try {
    const barber = await store.getBarberById(req.params.id);
    if (!barber) return res.status(404).json({ message: 'Barber not found.' });

    const shop = await store.getShopById(barber.shop_id);
    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to manage this barber.' });
    }

    const updated = await store.updateBarber(req.params.id, req.body || {});
    res.status(200).json({ message: `${updated.name} updated.`, barber: updated });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/barbers/:id ── (owner only, own shop)
async function deleteBarber(req, res, next) {
  try {
    const barber = await store.getBarberById(req.params.id);
    if (!barber) return res.status(404).json({ message: 'Barber not found.' });

    const shop = await store.getShopById(barber.shop_id);
    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to manage this barber.' });
    }

    await store.deleteBarber(req.params.id);
    res.status(200).json({ message: 'Barber removed.' });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/shops/:shopId/attendance?date=YYYY-MM-DD ── (public — marketplace reads this)
async function getAttendance(req, res, next) {
  try {
    const shop = await store.getShopByIdOrUsername(req.params.shopId);
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    const date = req.query.date;
    if (date && !DATE_RE.test(date)) {
      return res.status(400).json({ message: 'date must be in YYYY-MM-DD format.' });
    }

    const attendance = await store.getAttendanceForShop(shop.id, date);
    res.status(200).json({ date: date || new Date().toISOString().split('T')[0], attendance });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/barbers/:id/attendance ── (owner only, own shop)
// Body: { status: 'present' | 'leave' | 'half-day', date?: 'YYYY-MM-DD' }
async function setAttendance(req, res, next) {
  try {
    const barber = await store.getBarberById(req.params.id);
    if (!barber) return res.status(404).json({ message: 'Barber not found.' });

    const shop = await store.getShopById(barber.shop_id);
    if (!shop || shop.owner_id !== req.user.id) {
      return res.status(403).json({ message: 'You do not have permission to manage this barber.' });
    }

    const { status, date } = req.body || {};
    if (!VALID_ATTENDANCE_STATUSES.includes(status)) {
      return res.status(400).json({ message: `status must be one of: ${VALID_ATTENDANCE_STATUSES.join(', ')}.` });
    }
    if (date && !DATE_RE.test(date)) {
      return res.status(400).json({ message: 'date must be in YYYY-MM-DD format.' });
    }

    const entry = await store.setAttendance(barber.id, shop.id, status, date);
    res.status(200).json({ message: `${barber.name} marked ${status} for ${entry.date}.`, attendance: entry });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listBarbers,
  createBarber,
  updateBarber,
  deleteBarber,
  getAttendance,
  setAttendance,
};
