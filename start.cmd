@echo off
setlocal
cd /d "%~dp0"

if exist .env (
  for /f "usebackq tokens=* delims=" %%a in (".env") do (
    echo %%a | findstr /r "^[A-Za-z_][A-Za-z0-9_]*=" >nul && set "%%a"
  )
)

if not exist backend\node_modules (
  pushd backend
  call npm install
  popd
)

if not exist frontend\node_modules (
  pushd frontend
  call npm install
  popd
)

if not exist vault mkdir vault

start "Quire backend" cmd /c "cd /d "%~dp0backend" && npm run dev"

pushd frontend
call npm run dev
popd
