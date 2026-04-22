const { verifyToken } = require('../utils/token');

const requireAuth = (req, res, next) => {
  const authorizationHeader = String(req.headers.authorization || '');
  if (!authorizationHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authorizationHeader.slice(7).trim();
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  req.user = { id: payload.sub };
  return next();
};

module.exports = requireAuth;
