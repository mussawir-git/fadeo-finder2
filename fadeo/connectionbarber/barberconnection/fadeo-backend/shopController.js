const store = require('./store');

// ── GET /api/shops/pending ── (admin only)
async function listPending(req, res, next) {
  try {
    const shops = await store.listShopsByStatus('pending');
    res.status(200).json({ shops });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/shops ── (admin only) — all shops, any status
async function listAll(req, res, next) {
  try {
    const shops = await store.listShopsByStatus();
    res.status(200).json({ shops });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/shops/:id/approve ── (admin only)
async function approve(req, res, next) {
  try {
    const { id } = req.params;
    const shop = await store.updateShopStatus(id, 'approved');
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    res.status(200).json({ message: `${shop.shop_name} approved.`, shop });
  } catch (err) {
    next(err);
  }
}

// ── PATCH /api/shops/:id/reject ── (admin only)
async function reject(req, res, next) {
  try {
    const { id } = req.params;
    const shop = await store.updateShopStatus(id, 'rejected');
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    res.status(200).json({ message: `${shop.shop_name} rejected.`, shop });
  } catch (err) {
    next(err);
  }
}

// ── DELETE /api/shops/:id ── (admin only) — NEW
async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const shop = await store.deleteShop(id);
    if (!shop) return res.status(404).json({ message: 'Shop not found.' });

    res.status(200).json({ message: `${shop.shop_name} deleted.`, shop });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPending, listAll, approve, reject, remove };