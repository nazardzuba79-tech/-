@echo off
rem Paper trading: update the ledger. Works from any folder, keeps the window open,
rem and returns the exit code of the program (0 = fine).
chcp 65001 >nul 2>nul
where node >nul 2>nul
if errorlevel 1 goto nonode
node "%~dp0paper_trade.js" update
set "RC=%ERRORLEVEL%"
echo.
pause
exit /b %RC%
:nonode
echo Node.js не знайдено на цьому комп'ютері. Встановіть Node.js із сайту nodejs.org і запустіть цей файл ще раз.
echo Node.js was not found on this computer. Install it from nodejs.org and run this file again.
pause
exit /b 9
