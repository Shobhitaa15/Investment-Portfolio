const crypto = require('crypto');

const SCRYPT_KEYLEN = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

const hashPassword = async (plainPassword) => {
  const normalizedPassword = String(plainPassword);
  const salt = crypto.randomBytes(16).toString('hex');

  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(
      normalizedPassword,
      salt,
      SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, key) => {
        if (error) return reject(error);
        return resolve(key);
      }
    );
  });

  return `scrypt$${salt}$${Buffer.from(derivedKey).toString('hex')}`;
};

const verifyPassword = async (plainPassword, storedPassword) => {
  const normalizedPassword = String(plainPassword);
  const normalizedStored = String(storedPassword || '');

  // Backward compatibility for legacy plain-text users.
  if (!normalizedStored.startsWith('scrypt$')) {
    return {
      isValid: normalizedStored === normalizedPassword,
      needsRehash: normalizedStored === normalizedPassword,
    };
  }

  const parts = normalizedStored.split('$');
  if (parts.length !== 3) {
    return { isValid: false, needsRehash: false };
  }

  const [, salt, expectedHashHex] = parts;
  const expected = Buffer.from(expectedHashHex, 'hex');

  const derivedKey = await new Promise((resolve, reject) => {
    crypto.scrypt(
      normalizedPassword,
      salt,
      expected.length || SCRYPT_KEYLEN,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, key) => {
        if (error) return reject(error);
        return resolve(key);
      }
    );
  });

  if (expected.length !== Buffer.from(derivedKey).length) {
    return { isValid: false, needsRehash: false };
  }

  const isValid = crypto.timingSafeEqual(expected, Buffer.from(derivedKey));
  return { isValid, needsRehash: false };
};

module.exports = {
  hashPassword,
  verifyPassword,
};
