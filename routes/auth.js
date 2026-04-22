const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
const { hashPassword, verifyPassword } = require('../utils/password');
const { signToken } = require('../utils/token');

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

const buildAuthResponse = ({ id, name, email }) => ({
  token: signToken({ sub: id }),
  user: { id, name, email },
});

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

      return res.json(buildAuthResponse({
        id: created._id.toString(),
        name: created.name,
        email: created.email,
      }));
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
        return res.status(400).json({ error: 'Invalid email or password' });
      }

      const verification = await verifyPassword(password, user.password);
      if (!verification.isValid) {
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

      return res.json(buildAuthResponse({
        id: user._id.toString(),
        name: user.name,
        email: user.email,
      }));
    } catch (error) {
      console.warn('Login DB error, falling back to file storage:', error.message || error);
    }
  }

  const users = readUsers();
  const userIndex = users.findIndex((entry) => entry.email === normalizedEmail);
  if (userIndex < 0) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  const user = users[userIndex];
  const verification = await verifyPassword(password, user.password);
  if (!verification.isValid) {
    return res.status(400).json({ error: 'Invalid email or password' });
  }

  if (verification.needsRehash) {
    users[userIndex].password = await hashPassword(password);
    writeUsers(users);
  }

  return res.json(buildAuthResponse({ id: user.id, name: user.name, email: user.email }));
});

module.exports = router;
