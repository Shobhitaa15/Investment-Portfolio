const express = require('express');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const requireAuth = require('../middleware/auth');
const requireAdmin = require('../middleware/admin');
const User = require('../models/User');
const Portfolio = require('../models/Portfolio');
const {
  readActivityEvents,
  filterEventsByDays,
  getFeatureUsageBreakdown,
  getDailyActiveUsers,
  summarizeActivity,
  logActivityEvent,
} = require('../utils/activityLogger');
const { isAdminEmail } = require('../utils/admin');

const router = express.Router();
const usersFile = path.join(__dirname, '..', 'data', 'users.json');

const inDbMode = () => mongoose.connection.readyState === 1;

const toNumber = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const safeDays = (value) => {
  const parsed = toNumber(value, 30);
  if (parsed < 1) return 1;
  if (parsed > 180) return 180;
  return parsed;
};

const safeLimit = (value, fallback = 50) => {
  const parsed = toNumber(value, fallback);
  if (parsed < 1) return 1;
  if (parsed > 300) return 300;
  return parsed;
};

const readUsersFile = () => {
  try {
    const raw = fs.readFileSync(usersFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const fetchUsers = async () => {
  if (inDbMode()) {
    try {
      const dbUsers = await User.find({}).sort({ createdAt: -1 }).lean();
      if (Array.isArray(dbUsers) && dbUsers.length > 0) {
        return dbUsers.map((user) => ({
          id: user._id.toString(),
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
        }));
      }
    } catch (error) {
      console.warn('Admin users query failed, using file fallback:', error.message || error);
    }
  }

  return readUsersFile().map((user) => ({
    id: String(user.id || ''),
    name: String(user.name || ''),
    email: String(user.email || '').toLowerCase(),
    createdAt: user.createdAt || null,
  }));
};

const fetchPortfoliosMap = async () => {
  if (!inDbMode()) return new Map();
  try {
    const portfolios = await Portfolio.find({}).lean();
    return new Map(
      portfolios.map((portfolio) => [
        String(portfolio.userId || ''),
        {
          holdingsCount: Array.isArray(portfolio.holdings) ? portfolio.holdings.length : 0,
          totalValue: Number(portfolio.totalValue || 0),
          avgReturn: Number(portfolio.avgReturn || 0),
          updatedAt: portfolio.updatedAt || null,
        },
      ])
    );
  } catch (error) {
    console.warn('Admin portfolios query failed:', error.message || error);
    return new Map();
  }
};

router.use(requireAuth);
router.use(requireAdmin);

router.get('/overview', async (req, res) => {
  try {
    const days = safeDays(req.query.days);
    const allEvents = readActivityEvents();
    const scopedEvents = filterEventsByDays(allEvents, days);
    const summary = summarizeActivity(scopedEvents);
    const dailyActiveUsers = getDailyActiveUsers(scopedEvents).slice(-30);
    const featureUsage = getFeatureUsageBreakdown(scopedEvents).slice(0, 10);

    logActivityEvent({
      type: 'admin_overview_view',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 200,
      meta: { days },
    });

    res.json({
      days,
      summary,
      dailyActiveUsers,
      featureUsage,
      admin: {
        id: req.user?.id || '',
        email: req.user?.email || '',
      },
    });
  } catch (error) {
    logActivityEvent({
      type: 'admin_overview_failed',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 500,
      meta: { reason: 'server_error' },
    });
    res.status(500).json({ error: error.message || 'Failed to load admin overview.' });
  }
});

router.get('/events', async (req, res) => {
  try {
    const days = safeDays(req.query.days);
    const limit = safeLimit(req.query.limit, 80);
    const allEvents = readActivityEvents();
    const scopedEvents = filterEventsByDays(allEvents, days);

    const events = scopedEvents
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, limit)
      .map((event) => ({
        id: event.id,
        type: event.type,
        userId: event.userId,
        userEmail: event.userEmail,
        statusCode: event.statusCode,
        createdAt: event.createdAt,
        path: event.request?.path || '',
        method: event.request?.method || '',
        meta: event.meta || {},
      }));

    logActivityEvent({
      type: 'admin_events_view',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 200,
      meta: { days, limit },
    });

    res.json({ days, count: events.length, events });
  } catch (error) {
    logActivityEvent({
      type: 'admin_events_failed',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 500,
      meta: { reason: 'server_error' },
    });
    res.status(500).json({ error: error.message || 'Failed to load admin events.' });
  }
});

router.get('/users', async (req, res) => {
  try {
    const days = safeDays(req.query.days);
    const limit = safeLimit(req.query.limit, 120);
    const users = await fetchUsers();
    const portfoliosMap = await fetchPortfoliosMap();
    const events = filterEventsByDays(readActivityEvents(), days);

    const statsByUser = events.reduce((acc, event) => {
      const key = String(event.userId || '').trim();
      if (!key) return acc;
      if (!acc[key]) {
        acc[key] = {
          totalEvents: 0,
          logins: 0,
          chatMessages: 0,
          portfolioSaves: 0,
          unauthorizedHits: 0,
          lastActiveAt: null,
        };
      }

      const current = acc[key];
      current.totalEvents += 1;
      if (event.type === 'auth_login') current.logins += 1;
      if (event.type === 'chat_message') current.chatMessages += 1;
      if (event.type === 'portfolio_save') current.portfolioSaves += 1;
      if (event.type === 'auth_unauthorized') current.unauthorizedHits += 1;

      const timestamp = new Date(event.createdAt).getTime();
      const lastActive = current.lastActiveAt ? new Date(current.lastActiveAt).getTime() : 0;
      if (timestamp > lastActive) current.lastActiveAt = event.createdAt;
      return acc;
    }, {});

    const rows = users
      .map((user) => {
        const stats = statsByUser[user.id] || {
          totalEvents: 0,
          logins: 0,
          chatMessages: 0,
          portfolioSaves: 0,
          unauthorizedHits: 0,
          lastActiveAt: null,
        };
        const portfolio = portfoliosMap.get(user.id) || null;

        return {
          id: user.id,
          name: user.name || 'User',
          email: user.email || '',
          isAdmin: isAdminEmail(user.email),
          joinedAt: user.createdAt || null,
          lastActiveAt: stats.lastActiveAt,
          totalEvents: stats.totalEvents,
          logins: stats.logins,
          chatMessages: stats.chatMessages,
          portfolioSaves: stats.portfolioSaves,
          unauthorizedHits: stats.unauthorizedHits,
          portfolioHoldings: portfolio?.holdingsCount || 0,
          portfolioValue: portfolio?.totalValue || 0,
          avgReturn: portfolio?.avgReturn || 0,
        };
      })
      .sort((a, b) => b.totalEvents - a.totalEvents || (b.lastActiveAt || '').localeCompare(a.lastActiveAt || ''))
      .slice(0, limit);

    logActivityEvent({
      type: 'admin_users_view',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 200,
      meta: { days, limit },
    });

    res.json({ days, count: rows.length, users: rows });
  } catch (error) {
    logActivityEvent({
      type: 'admin_users_failed',
      userId: req.user?.id,
      userEmail: req.user?.email || '',
      req,
      statusCode: 500,
      meta: { reason: 'server_error' },
    });
    res.status(500).json({ error: error.message || 'Failed to load admin users.' });
  }
});

module.exports = router;
