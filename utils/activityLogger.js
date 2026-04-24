const fs = require('fs');
const path = require('path');

const eventsFile = path.join(__dirname, '..', 'data', 'activity-events.json');
const DEFAULT_LOG_LIMIT = 5000;

const toNumber = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const ensureEventsStore = () => {
  try {
    if (fs.existsSync(eventsFile)) return;
    fs.writeFileSync(eventsFile, '[]');
  } catch (error) {
    console.warn('Unable to initialize activity events store:', error.message || error);
  }
};

const readActivityEvents = () => {
  ensureEventsStore();
  try {
    const raw = fs.readFileSync(eventsFile, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const writeActivityEvents = (events = []) => {
  ensureEventsStore();
  try {
    fs.writeFileSync(eventsFile, JSON.stringify(events, null, 2));
  } catch (error) {
    console.warn('Unable to persist activity events:', error.message || error);
  }
};

const getLogLimit = () => {
  const configured = toNumber(process.env.ACTIVITY_LOG_LIMIT, DEFAULT_LOG_LIMIT);
  if (configured < 300) return 300;
  return configured;
};

const toIsoDate = (value = new Date()) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
};

const normalizeEventType = (value = '') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'unknown_event';

const buildRequestContext = (req = {}) => ({
  method: String(req.method || '').toUpperCase() || 'NA',
  path: String(req.originalUrl || req.url || '').trim() || '/',
  ip: String(req.headers?.['x-forwarded-for'] || req.ip || '').split(',')[0].trim() || 'unknown',
  userAgent: String(req.headers?.['user-agent'] || '').slice(0, 240),
});

const logActivityEvent = ({
  type,
  userId = '',
  userEmail = '',
  req = null,
  meta = {},
  statusCode = null,
}) => {
  const events = readActivityEvents();
  const event = {
    id: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type: normalizeEventType(type),
    userId: String(userId || '').trim() || '',
    userEmail: String(userEmail || '').trim().toLowerCase() || '',
    statusCode: Number.isFinite(Number(statusCode)) ? Number(statusCode) : null,
    createdAt: toIsoDate(),
    request: req ? buildRequestContext(req) : null,
    meta: meta && typeof meta === 'object' ? meta : {},
  };

  const cappedEvents = [...events, event].slice(-getLogLimit());
  writeActivityEvents(cappedEvents);
  return event;
};

const filterEventsByDays = (events = [], days = 30) => {
  const safeDays = Number.isFinite(Number(days)) && Number(days) > 0 ? Number(days) : 30;
  const from = Date.now() - (safeDays * 24 * 60 * 60 * 1000);
  return events.filter((event) => {
    const timestamp = new Date(event.createdAt || 0).getTime();
    return Number.isFinite(timestamp) && timestamp >= from;
  });
};

const getFeatureUsageBreakdown = (events = []) => {
  const usageMap = events.reduce((acc, event) => {
    const type = normalizeEventType(event.type);
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {});

  return Object.entries(usageMap)
    .map(([feature, count]) => ({ feature, count }))
    .sort((a, b) => b.count - a.count);
};

const getDailyActiveUsers = (events = []) => {
  const dayMap = new Map();
  events.forEach((event) => {
    if (!event.userId) return;
    const iso = toIsoDate(event.createdAt);
    const day = iso.slice(0, 10);
    if (!dayMap.has(day)) {
      dayMap.set(day, new Set());
    }
    dayMap.get(day).add(event.userId);
  });

  return Array.from(dayMap.entries())
    .map(([date, users]) => ({ date, users: users.size }))
    .sort((a, b) => a.date.localeCompare(b.date));
};

const summarizeActivity = (events = []) => {
  const uniqueUsers = new Set(events.map((event) => event.userId).filter(Boolean));
  const countByType = (type) => events.filter((event) => normalizeEventType(event.type) === type).length;

  return {
    totalEvents: events.length,
    uniqueUsers: uniqueUsers.size,
    signups: countByType('auth_register'),
    logins: countByType('auth_login'),
    chatMessages: countByType('chat_message'),
    portfolioSaves: countByType('portfolio_save'),
    unauthorized: countByType('auth_unauthorized'),
    apiErrors: events.filter((event) => Number(event.statusCode) >= 500).length,
  };
};

module.exports = {
  readActivityEvents,
  writeActivityEvents,
  logActivityEvent,
  filterEventsByDays,
  getFeatureUsageBreakdown,
  getDailyActiveUsers,
  summarizeActivity,
};

