const { verifyToken } = require('./jwt');

/**
 * Verifies the Bearer token on the request and attaches the decoded
 * payload to req.user. Use on any route that requires a logged-in user.
 */
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Missing or malformed Authorization header.' });
  }

  try {
    req.user = verifyToken(token); // { id, name, email, role, shop }
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired session. Please sign in again.' });
  }
}

/**
 * Restricts a route to one or more roles. Use AFTER authenticate.
 * Example: router.get('/admin-only', authenticate, requireRole('admin'), handler)
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: 'You do not have permission to do that.' });
    }
    next();
  };
}

module.exports = { authenticate, requireRole };
