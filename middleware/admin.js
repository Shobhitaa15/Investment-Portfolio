const { isAdminEmail, getAdminEmail } = require('../utils/admin');
const { logActivityEvent } = require('../utils/activityLogger');

const requireAdmin = (req, res, next) => {
  if (!getAdminEmail()) {
    logActivityEvent({
      type: 'admin_access_failed',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 503,
      meta: { reason: 'admin_email_not_configured' },
    });
    return res.status(503).json({ error: 'ADMIN_EMAIL is not configured on the server.' });
  }

  const email = String(req.user?.email || '').trim().toLowerCase();
  const isAdmin = isAdminEmail(email) || req.user?.isAdmin === true;

  if (!isAdmin) {
    logActivityEvent({
      type: 'admin_access_failed',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 403,
      meta: { reason: 'not_admin_user' },
    });
    return res.status(403).json({ error: 'Admin access required.' });
  }

  req.user = {
    ...req.user,
    isAdmin: true,
  };

  return next();
};

module.exports = requireAdmin;
