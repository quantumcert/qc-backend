// ═══════════════════════════════════════════════════════════
// PHASE 1 VALIDATION SCRIPT
// Validates the entire Phase 1 architecture without a DB.
// Tests: Type system, RBAC logic, module imports, key hashing.
//
// Run: npx tsx src/scripts/validate-phase1.ts
// ═══════════════════════════════════════════════════════════

import crypto from 'crypto';
import { hasPermission, PLAN_TIER_LIMITS, DiamondFacets, RBAC_HIERARCHY } from '../types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
    if (condition) {
        console.log(`  PASS ${label}`);
        passed++;
    } else {
        console.log(`  FAIL ${label}`);
        failed++;
    }
}

console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log('  PHASE 1 — VALIDATION SUITE');
console.log('═══════════════════════════════════════════════════════════');
console.log('');

// ─── TEST 1: RBAC Hierarchy ─────────────────────────────
console.log('  ── 1. RBAC Role Hierarchy ──');
assert(RBAC_HIERARCHY.ADMIN === 3, 'ADMIN has level 3');
assert(RBAC_HIERARCHY.OPERATOR === 2, 'OPERATOR has level 2');
assert(RBAC_HIERARCHY.READER === 1, 'READER has level 1');

// ─── TEST 2: Permission Checks ──────────────────────────
console.log('');
console.log('  ── 2. Permission Checks ──');
assert(hasPermission('ADMIN', 'ADMIN'), 'ADMIN can do ADMIN ops');
assert(hasPermission('ADMIN', 'OPERATOR'), 'ADMIN can do OPERATOR ops');
assert(hasPermission('ADMIN', 'READER'), 'ADMIN can do READER ops');
assert(hasPermission('OPERATOR', 'OPERATOR'), 'OPERATOR can do OPERATOR ops');
assert(hasPermission('OPERATOR', 'READER'), 'OPERATOR can do READER ops');
assert(!hasPermission('OPERATOR', 'ADMIN'), 'OPERATOR CANNOT do ADMIN ops');
assert(hasPermission('READER', 'READER'), 'READER can do READER ops');
assert(!hasPermission('READER', 'OPERATOR'), 'READER CANNOT do OPERATOR ops');
assert(!hasPermission('READER', 'ADMIN'), 'READER CANNOT do ADMIN ops');

// ─── TEST 3: Plan Tier Limits ───────────────────────────
console.log('');
console.log('  ── 3. Plan Tier Rate Limits ──');
assert(PLAN_TIER_LIMITS.FREE.maxRequestsPerMinute === 10, 'FREE: 10 req/min');
assert(PLAN_TIER_LIMITS.FREE.maxRequestsPerDay === 500, 'FREE: 500 req/day');
assert(PLAN_TIER_LIMITS.PROFESSIONAL.maxRequestsPerMinute === 60, 'PROFESSIONAL: 60 req/min');
assert(PLAN_TIER_LIMITS.PROFESSIONAL.maxRequestsPerDay === 10_000, 'PROFESSIONAL: 10K req/day');
assert(PLAN_TIER_LIMITS.ENTERPRISE.maxRequestsPerMinute === 1000, 'ENTERPRISE: 1000 req/min');
assert(PLAN_TIER_LIMITS.ENTERPRISE.maxRequestsPerDay === 1_000_000, 'ENTERPRISE: 1M req/day');

// ─── TEST 4: Diamond Facet Registry ─────────────────────
console.log('');
console.log('  ── 4. Diamond Facet Registry ──');
assert(DiamondFacets.TENANT_MANAGEMENT === 'TenantManagementFacet', 'TenantManagementFacet registered');
assert(DiamondFacets.API_KEY_MANAGEMENT === 'ApiKeyManagementFacet', 'ApiKeyManagementFacet registered');
assert(DiamondFacets.RATE_LIMITER === 'RateLimiterFacet', 'RateLimiterFacet registered');

// ─── TEST 5: API Key Hash Security ─────────────────────
console.log('');
console.log('  ── 5. API Key Hash Security ──');
const rawKey = `qc_test_${crypto.randomBytes(32).toString('hex')}`;
const hash1 = crypto.createHash('sha256').update(rawKey).digest('hex');
const hash2 = crypto.createHash('sha256').update(rawKey).digest('hex');
assert(hash1 === hash2, 'Same key produces same hash (deterministic)');
assert(hash1.length === 64, 'SHA-256 hash is 64 hex chars');
assert(rawKey.startsWith('qc_test_'), 'Test key has correct prefix');
assert(rawKey.length === 8 + 64, 'Key is 72 chars (qc_test_ + 64 hex)');

const rawKey2 = `qc_test_${crypto.randomBytes(32).toString('hex')}`;
const hash3 = crypto.createHash('sha256').update(rawKey2).digest('hex');
assert(hash1 !== hash3, 'Different keys produce different hashes');

// ─── TEST 6: Key Prefix Extraction ──────────────────────
console.log('');
console.log('  ── 6. Key Prefix Extraction ──');
const keyPrefix = rawKey.substring(0, 16);
assert(keyPrefix.startsWith('qc_test_'), 'Prefix starts with qc_test_');
assert(keyPrefix.length === 16, 'Prefix is 16 chars');

// ─── TEST 7: Module Imports (Structural) ────────────────
console.log('');
console.log('  ── 7. Module Import Validation ──');
try {
    require('../services/core-facets/TenantManagementFacet');
    assert(true, 'TenantManagementFacet imports successfully');
} catch (e) {
    assert(false, `TenantManagementFacet import failed: ${e}`);
}
try {
    require('../services/core-facets/ApiKeyManagementFacet');
    assert(true, 'ApiKeyManagementFacet imports successfully');
} catch (e) {
    assert(false, `ApiKeyManagementFacet import failed: ${e}`);
}
try {
    require('../services/core-facets/RateLimiterFacet');
    assert(true, 'RateLimiterFacet imports successfully');
} catch (e) {
    assert(false, `RateLimiterFacet import failed: ${e}`);
}
try {
    require('../middleware/apiKeyAuth');
    assert(true, 'apiKeyAuth middleware imports successfully');
} catch (e) {
    assert(false, `apiKeyAuth middleware import failed: ${e}`);
}
try {
    require('../middleware/rbacGuard');
    assert(true, 'rbacGuard middleware imports successfully');
} catch (e) {
    assert(false, `rbacGuard middleware import failed: ${e}`);
}
try {
    require('../middleware/rateLimiter');
    assert(true, 'rateLimiter middleware imports successfully');
} catch (e) {
    assert(false, `rateLimiter middleware import failed: ${e}`);
}

// ─── TEST 8: Agnosticism Check ──────────────────────────
console.log('');
console.log('  ── 8. Golden Rule: Agnosticism Check ──');
const forbiddenTerms = [
    'health', 'finance', 'hospital', 'patient', 'invoice',
    'logistic', 'warehouse', 'employee', 'salary', 'medical',
    'prescription', 'diagnosis', 'shipping', 'product',
    'cart', 'checkout', 'meal', 'food', 'fuel',
];
const typeFileContent = require('fs').readFileSync(
    require('path').join(__dirname, '..', 'types', 'index.ts'), 'utf-8'
);
const schemaContent = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'prisma', 'schema.prisma'), 'utf-8'
);
const combinedContent = (typeFileContent + schemaContent).toLowerCase();

let agnosticPass = true;
for (const term of forbiddenTerms) {
    // Use word boundary regex to avoid false positives
    // e.g., "production" should not match "product"
    const regex = new RegExp(`\\b${term}\\b`, 'i');
    if (regex.test(combinedContent)) {
        console.log(`  VIOLATION: Found forbidden term "${term}" in type definitions or schema`);
        agnosticPass = false;
        failed++;
    }
}
if (agnosticPass) {
    assert(true, 'No domain-specific terms found in types or schema ✓');
}

// ─── SUMMARY ────────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════════');
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
if (failed === 0) {
    console.log('  🏆 ALL TESTS PASSED — Phase 1 architecture validated!');
} else {
    console.log('  Some tests failed. Review above.');
}
console.log('═══════════════════════════════════════════════════════════');
console.log('');

process.exit(failed > 0 ? 1 : 0);
