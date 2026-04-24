const { verifyToken } = require('../utils/token');
const { isAdminEmail } = require('../utils/admin');
const { logActivityEvent } = require('../utils/activityLogger');

const requireAuth = (req, res, next) => {
  const authorizationHeader = String(req.headers.authorization || '');
  if (!authorizationHeader.startsWith('Bearer ')) {
    logActivityEvent({
      type: 'auth_unauthorized',
      req,
      statusCode: 401,
      meta: { reason: 'missing_bearer_token' },
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authorizationHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    logActivityEvent({
      type: 'auth_unauthorized',
      req,
      statusCode: 401,
      meta: { reason: 'invalid_or_expired_token' },
    });
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const email = String(payload.email || '').trim().toLowerCase();
  req.user = {
    id: payload.sub,
    email,
    isAdmin: payload.isAdmin === true || isAdminEmail(email),
  };
  return next();
};

module.exports = requireAuth;
