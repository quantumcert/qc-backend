# Prisma Sync Commands

Execute these commands in the WSL terminal to force database sync:

```bash
# 1. Navigate to project
cd /home/gustavo_aguiar/backend-QC-new

# 2. Ensure Node.js is available (NVM)
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"

# 3. Verify Node.js
node --version   # should show v20.x.x
npm --version    # should show 10.x.x

# 4. Install dependencies (if not already done)
npm install

# 5. Generate Prisma Client (reads schema, generates types)
npx prisma generate

# 6. Push schema to database (creates tables without migration)
npx prisma db push --accept-data-loss

# 7. Verify everything works — run all tests
npm test
```

If you get `DATABASE_URL` errors, ensure `.env` exists:
```bash
cat .env | grep DATABASE_URL
```

Expected output:
```
DATABASE_URL="postgresql://johndoe:randompassword@localhost:5432/mydb?schema=public"
```

If PostgreSQL is not running locally, start it:
```bash
sudo service postgresql start
# or
sudo systemctl start postgresql
