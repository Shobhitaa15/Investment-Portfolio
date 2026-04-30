const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');
const { isAdminEmail } = require('../utils/admin');
const { logActivityEvent } = require('../utils/activityLogger');

const router = express.Router();
const usersFile = path.join(__dirname, '..', 'data', 'users.json');

const normalizeEmail = (value = '') => String(value).trim().toLowerCase();
const inDbMode = () => mongoose.connection.readyState === 1;
const googleTokenInfoUrl = 'https://oauth2.googleapis.com/tokeninfo';

const getGoogleClientIds = () =>
  String(process.env.GOOGLE_CLIENT_IDS || process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '')
    .split(',')
    .map((clientId) => clientId.trim())
    .filter(Boolean);

const readUsers = () => {
  try {
    const raw = fs.readFileSync(usersFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return [];
  }
};

const writeUsers = (users) => {
  try {
    fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error('Failed to write users file:', err);
  }
};

const validateRequired = (name, email, password) => {
  if (!email || !password) return 'Missing required fields';
  if (name !== undefined && !name) return 'Missing required fields';
  if (String(password).length < 6) return 'Password must be at least 6 characters';
  return '';
};

const buildAuthResponse = ({ id, name, email, authProvider = 'password', avatar = '' }) => {
  const admin = isAdminEmail(email);
  return {
    token: signToken({ sub: id, email, isAdmin: admin }),
    user: { id, name, email, isAdmin: admin, authProvider, avatar },
  };
};

const verifyGoogleCredential = async (credential = '') => {
  const googleClientIds = getGoogleClientIds();
  if (!googleClientIds.length) {
    throw new Error('GOOGLE_CLIENT_ID is not configured on the server.');
  }

  const response = await fetch(`${googleTokenInfoUrl}?id_token=${encodeURIComponent(credential)}`);
  const profile = await response.json().catch(() => ({}));

  if (!response.ok || profile.error) {
    throw new Error(profile.error_description || 'Google credential could not be verified.');
  }

  if (!googleClientIds.includes(profile.aud)) {
    throw new Error('Google credential audience does not match this application.');
  }

  const email = normalizeEmail(profile.email);
  const emailVerified = profile.email_verified === true || profile.email_verified === 'true';
  if (!profile.sub || !email || !emailVerified) {
    throw new Error('Google account email is not verified.');
  }

  return {
    googleId: String(profile.sub),
    email,
    name: String(profile.name || profile.given_name || email.split('@')[0]).trim(),
    avatar: String(profile.picture || ''),
  };
};

const createGooglePasswordHash = () => hashPassword(crypto.randomBytes(32).toString('hex'));

const findOrCreateGoogleUser = async ({ googleId, email, name, avatar }) => {
  if (inDbMode()) {
    const existing = await User.findOne({ $or: [{ googleId }, { email }] });
    if (existing) {
      existing.googleId = existing.googleId || googleId;
      existing.authProvider = existing.authProvider === 'password' ? 'password' : 'google';
      existing.avatar = avatar || existing.avatar || '';
      existing.name = existing.name || name;
      await existing.save();
      return {
        id: existing._id.toString(),
        name: existing.name,
        email: existing.email,
        authProvider: existing.authProvider,
        avatar: existing.avatar,
      };
    }

    const created = await User.create({
      name,
      email,
      password: await createGooglePasswordHash(),
      googleId,
      avatar,
      authProvider: 'google',
    });

    return {
      id: created._id.toString(),
      name: created.name,
      email: created.email,
      authProvider: created.authProvider,
      avatar: created.avatar,
    };
  }

  const users = readUsers();
  const existingIndex = users.findIndex((user) => user.googleId === googleId || normalizeEmail(user.email) === email);
  if (existingIndex >= 0) {
    users[existingIndex] = {
      ...users[existingIndex],
      googleId: users[existingIndex].googleId || googleId,
      avatar: avatar || users[existingIndex].avatar || '',
      authProvider: users[existingIndex].authProvider || 'google',
      name: users[existingIndex].name || name,
    };
    writeUsers(users);
    const existing = users[existingIndex];
    return {
      id: String(existing.id || ''),
      name: existing.name,
      email: normalizeEmail(existing.email),
      authProvider: existing.authProvider,
      avatar: existing.avatar || '',
    };
  }

  const user = {
    id: Date.now().toString(),
    name,
    email,
    password: await createGooglePasswordHash(),
    googleId,
    avatar,
    authProvider: 'google',
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  writeUsers(users);

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    authProvider: user.authProvider,
    avatar: user.avatar,
  };
};

router.post('/register', async (req, res) => {
  const { name, email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const validationError = validateRequired(name, normalizedEmail, password);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (inDbMode()) {
    try {
      const existing = await User.findOne({ email: normalizedEmail }).lean();
      if (existing) {
        return res.status(400).json({ error: 'User already exists' });
      }

      const passwordHash = await hashPassword(password);

      const created = await User.create({
        name: String(name).trim(),
        email: normalizedEmail,
        password: passwordHash,
      });

      const response = buildAuthResponse({
        id: created._id.toString(),
        name: created.name,
        email: created.email,
      });

      logActivityEvent({
        type: 'auth_register',
        userId: response.user.id,
        userEmail: response.user.email,
        req,
        statusCode: 200,
      });

      return res.json(response);
    } catch (error) {
      if (error && error.code === 11000) {
        return res.status(400).json({ error: 'User already exists' });
      }
      console.warn('Register DB error, falling back to file storage:', error.message || error);
    }
  }

  const users = readUsers();
  const existing = users.find((user) => user.email === normalizedEmail);
  if (existing) {
    return res.status(400).json({ error: 'User already exists' });
  }

  const passwordHash = await hashPassword(password);
  const user = {
    id: Date.now().toString(),
    name: String(name).trim(),
    email: normalizedEmail,
    password: passwordHash,
  };
  users.push(user);
  writeUsers(users);

  logActivityEvent({
    type: 'auth_register',
    userId: user.id,
    userEmail: user.email,
    req,
    statusCode: 200,
  });

  return res.json(buildAuthResponse({ id: user.id, name: user.name, email: user.email }));
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const normalizedEmail = normalizeEmail(email);
  const validationError = validateRequired(undefined, normalizedEmail, password);

  if (validationError) {
    return res.status(400).json({ error: validationError });
  }

  if (inDbMode()) {
    try {
      const user = await User.findOne({ email: normalizedEmail }).lean();
      if (!user) {
        logActivityEvent({
          type: 'auth_login_failed',
          userEmail: normalizedEmail,
          req,
          statusCode: 400,
          meta: { reason: 'user_not_found' },
        });
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      const verification = await verifyPassword(password, user.password);
      if (!verification.isValid) {
        logActivityEvent({
          type: 'auth_login_failed',
          userId: user._id?.toString(),
          userEmail: normalizedEmail,
          req,
          statusCode: 400,
          meta: { reason: 'invalid_password' },
        });
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      if (verification.needsRehash) {
        const upgradedHash = await hashPassword(password);
        try {
          await User.updateOne({ _id: user._id }, { password: upgradedHash });
        } catch (rehashError) {
          console.warn('Could not upgrade DB password hash:', rehashError.message || rehashError);
        }
      }

      const response = buildAuthResponse({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      });

      logActivityEvent({
        type: 'auth_login',
        userId: response.user.id,
        userEmail: response.user.email,
        req,
        statusCode: 200,
      });

      return res.json(response);
    } catch (error) {
      console.warn('Login DB error, falling back to file storage:', error.message || error);
    }
  }

  const users = readUsers();
  const userIndex = users.findIndex((entry) => entry.email === normalizedEmail);
  if (userIndex < 0) {
    logActivityEvent({
      type: 'auth_login_failed',
      userEmail: normalizedEmail,
      req,
      statusCode: 400,
      meta: { reason: 'user_not_found' },
    });
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const user = users[userIndex];
  const verification = await verifyPassword(password, user.password);
  if (!verification.isValid) {
    logActivityEvent({
      type: 'auth_login_failed',
      userId: user.id,
      userEmail: normalizedEmail,
      req,
      statusCode: 400,
      meta: { reason: 'invalid_password' },
    });
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  if (verification.needsRehash) {
    users[userIndex].password = await hashPassword(password);
    writeUsers(users);
  }

  const response = buildAuthResponse({ id: user.id, name: user.name, email: user.email });

  logActivityEvent({
    type: 'auth_login',
    userId: response.user.id,
    userEmail: response.user.email,
    req,
    statusCode: 200,
  });

  return res.json(response);
});

router.post('/google', async (req, res) => {
  try {
    const credential = String(req.body?.credential || '').trim();
    if (!credential) {
      logActivityEvent({
        type: 'auth_google_failed',
        req,
        statusCode: 400,
        meta: { reason: 'missing_credential' },
      });
      return res.status(400).json({ error: 'Google credential is required' });
    }

    const googleProfile = await verifyGoogleCredential(credential);
    const user = await findOrCreateGoogleUser(googleProfile);
    const response = buildAuthResponse(user);

    logActivityEvent({
      type: 'auth_google_login',
      userId: response.user.id,
      userEmail: response.user.email,
      req,
      statusCode: 200,
    });

    return res.json(response);
  } catch (error) {
    const statusCode = /configured/.test(error.message || '') ? 503 : 401;
    logActivityEvent({
      type: 'auth_google_failed',
      req,
      statusCode,
      meta: { reason: error.message || 'google_auth_failed' },
    });
    return res.status(statusCode).json({ error: error.message || 'Google sign-in failed' });
  }
});

module.exports = router;
