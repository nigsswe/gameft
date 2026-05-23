@echo off
REM ОЧЕНЬ ВАЖНО: не закрывать окно ни при каких условиях
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1
title BattleRoyale Multiplayer Launcher
color 0A

cd /d "%~dp0"

echo ============================================================
echo   MINI BATTLE ROYALE - Multiplayer Launcher
echo ============================================================
echo.
echo Working dir: %cd%
echo.

REM ----- Шаг 1: Node.js -----
echo [1/6] Проверка Node.js...
where node >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] Node.js не найден в PATH.
    echo     Скачай и установи: https://nodejs.org/
    goto :END
)
node -v
echo.

REM ----- Шаг 2: npm install ws -----
echo [2/6] Проверка зависимости 'ws'...
if not exist "node_modules\ws\package.json" (
    echo     Устанавливаю ws...
    call npm install ws --silent
    if errorlevel 1 (
        echo [!] npm install ws — ошибка.
        goto :END
    )
)
echo     OK
echo.

REM ----- Шаг 3: ngrok -----
echo [3/6] Проверка ngrok...
where ngrok >nul 2>nul
if errorlevel 1 (
    echo.
    echo [!] ngrok не найден в PATH.
    echo     Решение 1: скачай ngrok.exe с https://ngrok.com/download
    echo                и положи его в эту папку: %cd%
    echo     Решение 2: переходи в режим LAN ^(только локальная сеть^)
    echo.
    set /p "USE_LAN=Запустить только LAN-сервер? (y/n): "
    if /i "!USE_LAN!"=="y" goto :LAN_ONLY
    goto :END
)
ngrok version
echo.

REM ----- Шаг 4: ngrok authtoken -----
echo [4/6] Привязка ngrok authtoken...
ngrok config add-authtoken 3E7PxOgCUpi2X74CNSNfnyOdLaN_fVow5SgyF5mZ1wcYkQ6H
if errorlevel 1 (
    echo [!] Не удалось привязать authtoken.
    goto :END
)
echo.

REM ----- Шаг 5: Запуск сервера и ngrok -----
echo [5/6] Запуск игрового сервера на порту 8080...
start "BattleRoyale Server" cmd /k "cd /d %cd% && node server.js"
timeout /t 3 /nobreak >nul

echo         Запуск ngrok туннеля...
start "ngrok tunnel" cmd /k "ngrok http 8080"
echo         Жду 6 секунд, пока ngrok получит URL...
timeout /t 6 /nobreak >nul
echo.

REM ----- Шаг 6: Получаем URL -----
echo [6/6] Получение публичного URL...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 5 -ErrorAction Stop; $url = ($r.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1).public_url; if (-not $url) { $url = $r.tunnels[0].public_url }; Write-Host ''; Write-Host '============================================================' -ForegroundColor Green; Write-Host '  СЕРВЕР ЗАПУЩЕН!' -ForegroundColor Green; Write-Host '============================================================' -ForegroundColor Green; Write-Host ''; Write-Host '  Ссылка для друзей:' -ForegroundColor Yellow; Write-Host ('     ' + $url) -ForegroundColor Cyan; Write-Host ''; Set-Clipboard -Value $url; Write-Host '  (URL скопирован в буфер обмена)' -ForegroundColor DarkGray; Write-Host '============================================================' -ForegroundColor Green } catch { Write-Host ''; Write-Host '[!] Не удалось получить URL от ngrok API.' -ForegroundColor Red; Write-Host '    Проверь окно ngrok вручную или открой http://127.0.0.1:4040' -ForegroundColor Red }"

echo.
echo [INFO] Открываю игру в браузере...
start "" "index.html"

goto :END

:LAN_ONLY
echo.
echo [LAN] Запуск локального сервера...
start "BattleRoyale Server" cmd /k "cd /d %cd% && node server.js"
timeout /t 2 /nobreak >nul
echo.
echo Твой локальный IPv4:
powershell -NoProfile -Command "Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.*' } | Select-Object -ExpandProperty IPAddress"
echo.
echo Друзья в той же Wi-Fi заходят: http://ТВОЙ_IP:8080
echo.
start "" "index.html"

:END
echo.
echo ============================================================
echo   ОКНО НЕ ЗАКРЫВАЕТСЯ АВТОМАТИЧЕСКИ.
echo   Нажми любую клавишу когда захочешь его закрыть.
echo ============================================================
pause >nul
endlocal
