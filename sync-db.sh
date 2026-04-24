#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════
# SYNC-DB.SH — Prisma Database Sync Automation Script
# Loads .env vars, generates Prisma Client, pushes schema,
# and runs the full test suite.
# ═══════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "═══════════════════════════════════════════════════════════"
echo "  QUANTUM CERT — Prisma DB Sync & Test Runner"
echo "═══════════════════════════════════════════════════════════"
echo ""

# ── Step 1: Load .env variables ───────────────────────────
if [ -f .env ]; then
    echo "[1/5] Loading environment variables from .env..."
    # Export all KEY=VALUE lines (skip comments and empty lines)
    # Removes surrounding quotes from values to prevent P1012
    while IFS='=' read -r key value; do
        # Skip empty lines and comments
        [[ -z "$key" || "$key" =~ ^[[:space:]]*# ]] && continue
        # Trim whitespace from key
        key=$(echo "$key" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        # Remove surrounding quotes from value (both " and ')
        value=$(echo "$value" | sed 's/^["'\'']//;s/["'\'']$//')
        export "$key=$value"
    done < .env
    echo "      ✓ DATABASE_URL loaded: ${DATABASE_URL:-NOT SET}"
else
    echo "      ✗ .env file not found! Aborting."
    exit 1
fi

echo ""

# ── Step 2: Verify Node.js ────────────────────────────────
echo "[2/5] Checking Node.js environment..."
if ! command -v node &> /dev/null; then
    echo "      ✗ Node.js not found. Please install Node.js in WSL."
    echo "        Run: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
    echo "        Then: nvm install 20"
    exit 1
fi

if ! command -v npx &> /dev/null; then
    echo "      ✗ npx not found. Please ensure npm is installed."
    exit 1
fi

NODE_VERSION=$(node --version)
echo "      ✓ Node.js version: $NODE_VERSION"
echo ""

# ── Step 3: Install dependencies (if needed) ──────────────
echo "[3/5] Checking dependencies..."
if [ ! -d "node_modules" ] || [ ! -f "node_modules/.package-lock.json" ]; then
    echo "      → node_modules missing or incomplete. Running npm install..."
    npm install
else
    echo "      ✓ node_modules present"
fi
echo ""

# ── Step 4: Prisma Generate ───────────────────────────────
echo "[4/5] Generating Prisma Client..."
npx prisma generate
echo "      ✓ Prisma Client generated"
echo ""

# ── Step 5: Prisma DB Push ────────────────────────────────
echo "[5/5] Pushing database schema (with --accept-data-loss)..."

if command -v pg_isready &> /dev/null; then
    if ! pg_isready -h localhost -p 5432 > /dev/null 2>&1; then
        echo ""
        echo "      ⚠ PostgreSQL is NOT running at localhost:5432."
        echo ""
        echo "      Options to proceed:"
        echo ""
        echo "      A) Start PostgreSQL in WSL:"
        echo "         sudo service postgresql start"
        echo "         OR"
        echo "         sudo systemctl start postgresql"
        echo ""
        echo "      B) Use Docker:"
        echo "         docker run -d --name qc-postgres \\"
        echo "           -e POSTGRES_USER=johndoe \\"
        echo "           -e POSTGRES_PASSWORD=randompassword \\"
        echo "           -e POSTGRES_DB=mydb \\"
        echo "           -p 5432:5432 postgres:16"
        echo ""
        echo "      C) Run tests WITHOUT database (tests use mocks):"
        echo "         npm test"
        echo ""
        echo "      Skipping DB push. Running tests with mocks..."
        echo ""
        DB_ONLINE=false
    else
        npx prisma db push --accept-data-loss
        echo "      ✓ Database schema synced"
        echo ""
        DB_ONLINE=true
    fi
else
    echo "      ⚠ pg_isready not found. Cannot check PostgreSQL status."
    echo "      Attempting DB push anyway..."
    if npx prisma db push --accept-data-loss 2>/dev/null; then
        DB_ONLINE=true
    else
        echo "      ✗ DB push failed. Running tests with mocks..."
        DB_ONLINE=false
    fi
    echo ""
fi

# ── Step 6: Run Tests ─────────────────────────────────────
echo "═══════════════════════════════════════════════════════════"
echo "  Running Test Suite..."
echo "═══════════════════════════════════════════════════════════"
echo ""

npm test

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ "${DB_ONLINE:-false}" = true ]; then
    echo "  ✓ ALL DONE — Database synced and tests completed"
else
    echo "  ✓ Tests completed (Database offline — schema not pushed)"
fi
echo "═══════════════════════════════════════════════════════════"
