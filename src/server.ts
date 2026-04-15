// ═══════════════════════════════════════════════════════════
// QUANTUM CERT — DIAMOND PATTERN UNIVERSAL API
// Architecture: EIP-2535 Faceted Diamond Pattern
// Version: 3.0.0 — Phase 1: Multi-Tenant Engine & Access Control
//
// The Diamond Pattern treats each capability as an independent
// Facet that can be added, replaced, or removed without
// modifying the core. The API server is the "Diamond" that
// delegates all operations to Facets.
//
// GOLDEN RULE: 100% AGNOSTIC — No domain-specific terms.
// Only universal terms: Tenant, Asset, Device, Event, Owner, Metadata.
// ═══════════════════════════════════════════════════════════

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';

import routes from './routes/index';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import prisma from './config/prisma';
import { SchedulerService } from './services/SchedulerService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────────────────
// MIDDLEWARE GLOBAL
// ─────────────────────────────────────────────────────────
app.use(helmet());

// RED TEAM HOTFIX 1 (DDoS Auto-infligido): Trust the reverse proxy correctly
app.set('trust proxy', 1);

// CORS — Whitelist frontend origins
const allowedOrigins = [
  process.env.FRONTEND_URL || 'http://localhost:5173',
  'http://localhost:3001',
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, Postman)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Requested-With'],
  exposedHeaders: [
    'X-Total-Count',
    'X-RateLimit-Limit-Minute',
    'X-RateLimit-Remaining-Minute',
    'X-RateLimit-Limit-Day',
    'X-RateLimit-Remaining-Day',
    'Retry-After',
  ],
  maxAge: 86400,
}));

// RED TEAM HOTFIX 8: Body Parser Limit (Anti-DoS)
app.use(express.json({ limit: '500kb' }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────────────────
// GLOBAL IP RATE LIMITING (DDoS / Brute Force Protection)
// This is a per-IP limiter. Tenant-level limiting is in
// the tenantRateLimiter middleware.
// ─────────────────────────────────────────────────────────
const ipRateLimitMap = new Map<string, { count: number; resetAt: number }>();
const IP_RATE_LIMIT_WINDOW = 60_000; // 1 minute
const IP_RATE_LIMIT_MAX = 200;       // generous — tenant limiter is stricter

app.use((req, res, next) => {
  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  const entry = ipRateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    ipRateLimitMap.set(ip, { count: 1, resetAt: now + IP_RATE_LIMIT_WINDOW });
    return next();
  }

  if (entry.count >= IP_RATE_LIMIT_MAX) {
    res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({
      success: false,
      error: 'Too many requests from this IP. Try again later.',
      retryAfterMs: entry.resetAt - now,
    });
  }

  entry.count++;
  next();
});

// Cleanup IP rate limit map every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of ipRateLimitMap.entries()) {
    if (now > entry.resetAt) ipRateLimitMap.delete(ip);
  }
}, 300_000);

// ─────────────────────────────────────────────────────────
// HEALTH CHECK
// ─────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'disconnected';
  }

  res.json({
    success: true,
    data: {
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'Quantum Cert Diamond API',
      version: '3.0.0',
      architecture: 'EIP-2535 Faceted Diamond Pattern',
      phase: 'Phase 1 — Multi-Tenant Engine & Access Control',
      database: dbStatus,
      facets: [
        'TenantManagementFacet',
        'ApiKeyManagementFacet',
        'RateLimiterFacet',
      ],
    },
  });
});

// ─────────────────────────────────────────────────────────
// API ROUTES (via centralized Diamond router)
// ─────────────────────────────────────────────────────────
app.use('/api', routes);

// ─────────────────────────────────────────────────────────
// ERROR HANDLING
// ─────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─────────────────────────────────────────────────────────
// FAIL-FAST: ENVIRONMENT VALIDATION
// ─────────────────────────────────────────────────────────
// SERVER STARTUP (skipped when imported by test suite)
// ─────────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  const REQUIRED_ENV_VARS = ['DATABASE_URL', 'ALGOD_SERVER', 'ALGORAND_MASTER_MNEMONIC'];
  const missingVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);

  if (missingVars.length > 0) {
    console.error('\n❌ [FATAL ERROR] Failed to start Quantum Cert Core Engine.');
    console.error(`Missing required environment variables: ${missingVars.join(', ')}`);
    console.error('Production deployment requires strict definition of all endpoints and secrets.');
    process.exit(1);
  }

  app.listen(PORT, () => {
    SchedulerService.start();

  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('  QUANTUM CERT — DIAMOND PATTERN UNIVERSAL API');
  console.log('  Architecture: EIP-2535 Faceted Diamond Pattern');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  console.log(`  🚀  Server running on port ${PORT}`);
  console.log(`  📊  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`  🔗  Health: http://localhost:${PORT}/health`);
  console.log('');
  console.log('  ── Phase 1: Multi-Tenant Engine & Access Control ──');
  console.log('');
  console.log('  📌 Diamond Facets:');
  console.log('     ▸ TenantManagementFacet');
  console.log('     ▸ ApiKeyManagementFacet');
  console.log('     ▸ RateLimiterFacet');
  console.log('');
  console.log('  📌 Endpoints:');
  console.log(`     POST   /api/v1/tenants              → Create Tenant`);
  console.log(`     GET    /api/v1/tenants              → List Tenants`);
  console.log(`     GET    /api/v1/tenants/:id          → Get Tenant`);
  console.log(`     PATCH  /api/v1/tenants/:id          → Update Tenant`);
  console.log(`     POST   /api/v1/tenants/:id/deactivate → Deactivate`);
  console.log(`     POST   /api/v1/tenants/:id/reactivate → Reactivate`);
  console.log(`     GET    /api/v1/tenants/:id/usage    → Usage Stats`);
  console.log('');
  console.log(`     POST   /api/v1/api-keys             → Generate Key`);
  console.log(`     GET    /api/v1/api-keys/:tenantId   → List Keys`);
  console.log(`     DELETE /api/v1/api-keys/:id         → Revoke Key`);
  console.log(`     POST   /api/v1/api-keys/:id/rotate  → Rotate Key`);
  console.log('');
  console.log('═══════════════════════════════════════════════════════════');
  console.log('');
  }); // end app.listen
} // end NODE_ENV !== 'test'

// ─────────────────────────────────────────────────────────
// GRACEFUL SHUTDOWN
// ─────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received, closing server...');
  await prisma.$disconnect();
  process.exit(0);
});

export { app, prisma };
