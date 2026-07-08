const bcrypt = require('bcryptjs');
const { signToken } = require('./jwt');
const store = require('./store');

const SALT_ROUNDS = 10;
const VALID_ROLES = ['customer', 'owner']; // admin accounts are seeded, not self-registered

// ── POST /api/auth/register ────────────────────────────────
async function register(req, res, next) {
  try {
    const { name, email, password, role, shopName, shopLocation } = req.body;
    let shopUsername = req.body.shopUsername;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: 'Name, email, password, and role are required.' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ message: 'Invalid role. Admin accounts cannot self-register.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ message: 'Password must be at least 8 characters.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existingUser = await store.findUserByEmail(normalizedEmail);
    if (existingUser) {
      return res.status(409).json({ message: 'An account with this email already exists.' });
    }

    if (role === 'owner') {
      if (!shopName || !shopUsername || !shopLocation) {
        return res.status(400).json({ message: 'Shop name, shop username, and location are required for owners.' });
      }
      shopUsername = shopUsername.trim().toLowerCase();

      const existingShop = await store.getShopByUsername(shopUsername);
      if (existingShop) {
        return res.status(409).json({ message: 'That shop username is already taken.' });
      }
    }

    const newUser = await store.createUser({
      name: name.trim(),
      email: normalizedEmail,
      password,
      role,
    });

    // Customers get logged in immediately.
    if (role === 'customer') {
      const token = signToken({
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        role: newUser.role,
        shop: null,
      });

      return res.status(201).json({
        message: 'Account created successfully.',
        token,
        user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, shop: null },
      });
    }

    // Owners: create the shop record as 'pending' and do NOT log them in yet.
    await store.createShop({
      ownerId: newUser.id,
      shopName: shopName.trim(),
      shopUsername,
      location: shopLocation.trim(),
    });

    return res.status(201).json({
      message: `Shop "${shopName}" registered. Awaiting admin approval before you can sign in.`,
    });
  } catch (err) {
    next(err);
  }
}

// ── POST /api/auth/login ────────────────────────────────────
async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password are required.' });
    }

    const normalizedEmail = email.trim().toLowerCase();

    const user = await store.findUserByEmail(normalizedEmail);
    if (!user) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ message: 'Invalid email or password.' });
    }

    let shopUsername = null;

    if (user.role === 'owner') {
      const shop = await store.getShopByOwnerId(user.id);
      if (!shop) {
        return res.status(403).json({ message: 'No shop is linked to this account.' });
      }
      if (shop.status === 'pending') {
        return res.status(403).json({ message: 'Your shop is still awaiting admin approval.' });
      }
      if (shop.status === 'rejected') {
        return res.status(403).json({ message: 'Your shop registration was not approved. Contact support.' });
      }
      shopUsername = shop.shop_username;
    }

    const token = signToken({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      shop: shopUsername,
    });

    return res.status(200).json({
      message: 'Login successful.',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, shop: shopUsername },
    });
  } catch (err) {
    next(err);
  }
}

// ── GET /api/auth/me ─────────────────────────────────────────
// Lets the frontend verify a stored token / session is still valid.
async function me(req, res) {
  res.status(200).json({ user: req.user });
}

module.exports = { register, login, me };
