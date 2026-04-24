const express = require('express');
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

const buildAuthResponse = ({ id, name, email }) => {
  const admin = isAdminEmail(email);
  return {
    token: signToken({ sub: id, email, isAdmin: admin }),
    user: { id, name, email, isAdmin: admin },
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

module.exports = router;
