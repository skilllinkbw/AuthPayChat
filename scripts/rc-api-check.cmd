@echo off
REM PayChat release-candidate API verification:
REM  1. Production env WITHOUT mandatory secrets must refuse to boot (fail-safe).
REM  2. Fully configured dev env must boot, pass /healthz, /readyz and the e2e smoke.
setlocal enabledelayedexpansion
cd /d "%~dp0.."

echo === [1] Production boot without JWT_SECRET (must FAIL safely) ===
set PAYCHAT_ENV=production
set DATABASE_PATH=.data\rc-prod-test.db
set PORT=4599
node dist/api/index.js > rc-prod-boot.log 2>&1
echo production-boot-exit=%errorlevel%
type rc-prod-boot.log

echo === [2] Configured development boot + seed + health + e2e smoke ===
set PAYCHAT_ENV=development
set DATABASE_PATH=.data\rc-dev-test.db
set JWT_SECRET=rc-verification-secret-0123456789abcdef
set TOKEN_ENCRYPTION_KEY=rc-verification-key-0123456789abcdef
set INTERNAL_JOB_TOKEN=rc-verification-internal
set PORT=4599
if exist .data\rc-dev-test.db del .data\rc-dev-test.db
call npm run seed
start "paychat-api" /min cmd /c "node dist/api/index.js > rc-dev-boot.log 2>&1"
timeout /t 6 /nobreak > nul

curl -s http://127.0.0.1:4599/healthz
echo.
echo ---
curl -s http://127.0.0.1:4599/readyz
echo.
echo ---
npx tsx scripts/e2e-smoke.ts http://127.0.0.1:4599
set SMOKE_EXIT=%errorlevel%
echo smoke-exit=%SMOKE_EXIT%

for /f "tokens=5" %%p in ('netstat -aon ^| findstr :4599 ^| findstr LISTENING') do taskkill /PID %%p /F > nul 2>&1
echo done