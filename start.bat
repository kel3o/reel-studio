@echo off
cd /d "%~dp0"
for /f "delims=" %%p in ('node -e "let c={};try{c=require('./config.json')}catch(e){c=require('./config.example.json')};console.log(c.port||7180)"') do set REEL_PORT=%%p
start "" cmd /c "timeout /t 2 >nul && start http://127.0.0.1:%REEL_PORT%"
node server.js
