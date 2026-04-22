const crypto = require('crypto');

const DEFAULT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const decode = (value) => JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));

const getTokenSecret = () => process.env.AUTH_TOKEN_SECRET || '';

const signToken = ({ sub }) => {
  const tokenSecret = getTokenSecret();
  if (!tokenSecret) {
    throw new Error('AUTH_TOKEN_SECRET is missing');
  }

  const ttlRaw = Number.parseInt(process.env.AUTH_TOKEN_TTL_SECONDS, 10);
  const ttl = Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : DEFAULT_TOKEN_TTL_SECONDS;
  const payload = {
    sub: String(sub),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + ttl,
  };

  const encodedPayload = encode(payload);
  const signature = crypto.createHmac('sha256', tokenSecret).update(encodedPayload).digest('base64url');
  return `${encodedPayload}.${signature}`;
};

const verifyToken = (token = '') => {
  const tokenSecret = getTokenSecret();
  if (!tokenSecret || !token.includes('.')) return null;

  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) return null;

  const expectedSignature = crypto.createHmac('sha256', tokenSecret).update(encodedPayload).digest('base64url');
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);

  if (signatureBuffer.length !== expectedBuffer.length) return null;
  if (!crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) return null;

  let payload;
  try {
    payload = decode(encodedPayload);
  } catch {
    return null;
  }

  if (!payload || typeof payload.sub !== 'string' || !payload.sub) return null;
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;

  return payload;
};

module.exports = {
  signToken,
  verifyToken,
};
