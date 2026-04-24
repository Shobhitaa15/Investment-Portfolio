const normalizeEmail = (value = '') => String(value || '').trim().toLowerCase();

const getAdminEmail = () => normalizeEmail(process.env.ADMIN_EMAIL || '');

const isAdminEmail = (email = '') => {
  const adminEmail = getAdminEmail();
  if (!adminEmail) return false;
  return normalizeEmail(email) === adminEmail;
};

module.exports = {
  normalizeEmail,
  getAdminEmail,
  isAdminEmail,
};

