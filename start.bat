@echo off
cd /d "%~dp0"
for /f "delims=" %%p in ('node -e "let c={};try{c=require('./config.json')}catch(e){c=require('./config.example.json')};console.log(c.port||7180)"') do set REEL_PORT=%%p

rem If a server is already running from an earlier launch, do not start a
rem second one on the same port, it just crashes with "address already in
rem use". Open the page in the browser and stop here instead.
netstat -ano | findstr /r /c:":%REEL_PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  start "" http://127.0.0.1:%REEL_PORT%
  exit /b 0
)

start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:%REEL_PORT%"
node server.js
