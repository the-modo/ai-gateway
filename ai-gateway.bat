@echo off
setlocal enabledelayedexpansion
:: ai-gateway.bat — Manage the AI Gateway + Dashboard stack on Windows
:: Usage: ai-gateway.bat {start|dev|stop|build|release|status|health|help}

set ROOT=%~dp0
set ROOT=%ROOT:~0,-1%
set DASHBOARD_DIR=%ROOT%\dashboard
set LOG_DIR=%ROOT%\logs
set RUN_DIR=%ROOT%\run
set GW_PID_FILE=%RUN_DIR%\gateway.pid
set UI_PID_FILE=%RUN_DIR%\dashboard.pid
set GW_LOG=%LOG_DIR%\gateway.log
set UI_LOG=%LOG_DIR%\dashboard.log
set BINARY=%ROOT%\target\release\ai-gateway.exe

if not defined GATEWAY_PORT   set GATEWAY_PORT=4891
if not defined DASHBOARD_PORT set DASHBOARD_PORT=4892

set CMD=%1
if "%CMD%"=="" set CMD=help

if /i "%CMD%"=="start"   goto cmd_start
if /i "%CMD%"=="dev"     goto cmd_dev
if /i "%CMD%"=="stop"    goto cmd_stop
if /i "%CMD%"=="build"   goto cmd_build
if /i "%CMD%"=="release" goto cmd_release
if /i "%CMD%"=="status"  goto cmd_status
if /i "%CMD%"=="health"  goto cmd_health
if /i "%CMD%"=="help"    goto cmd_help
echo [ai-gateway] Unknown command: %CMD%
goto cmd_help

:: ─── helpers ────────────────────────────────────────────────────────────────

:log
echo [ai-gateway] %~1
goto :eof

:ok
echo   + %~1
goto :eof

:err
echo   x %~1
goto :eof

:die
call :err "%~1"
exit /b 1

:pid_alive
set _PA_FILE=%~1
set _PA_RESULT=0
if not exist "%_PA_FILE%" goto :eof
set /p _PA_PID=<"%_PA_FILE%"
tasklist /FI "PID eq %_PA_PID%" 2>nul | findstr /I "%_PA_PID%" >nul 2>&1
if %ERRORLEVEL%==0 set _PA_RESULT=1
goto :eof

:port_in_use
netstat -ano 2>nul | findstr ":%~1 " >nul 2>&1
goto :eof

:graceful_stop
set _GS_FILE=%~1
set _GS_LABEL=%~2
if not exist "%_GS_FILE%" goto :eof
set /p _GS_PID=<"%_GS_FILE%"
taskkill /PID %_GS_PID% /F >nul 2>&1
del /f "%_GS_FILE%" >nul 2>&1
call :ok "Stopped %_GS_LABEL% (pid %_GS_PID%)"
goto :eof

:wait_http
set _WH_URL=%~1
set _WH_LABEL=%~2
<nul set /p ="  Waiting for %_WH_LABEL%"
for /L %%i in (1,1,45) do (
    curl -sf -o nul --max-time 2 "%_WH_URL%" >nul 2>&1
    if !ERRORLEVEL!==0 (
        echo  ready
        goto :eof
    )
    <nul set /p ="."
    timeout /t 1 /nobreak >nul
)
echo  timeout
call :die "%_WH_LABEL% did not respond in time — check %LOG_DIR%\"
goto :eof

:check_deps
where cargo >nul 2>&1 || call :die "cargo not found — install Rust: https://rustup.rs"
where node  >nul 2>&1 || call :die "node not found — install Node.js >= 18"
where npm   >nul 2>&1 || call :die "npm not found"
if not exist "%ROOT%\gateway.toml" call :die "gateway.toml not found in %ROOT%"
call :ok "Dependencies OK"
goto :eof

:check_ports
call :port_in_use %GATEWAY_PORT%
if %ERRORLEVEL%==0 call :die "Port %GATEWAY_PORT% already in use"
call :port_in_use %DASHBOARD_PORT%
if %ERRORLEVEL%==0 call :die "Port %DASHBOARD_PORT% already in use"
call :ok "Ports %GATEWAY_PORT% and %DASHBOARD_PORT% are free"
goto :eof

:: ─── build ──────────────────────────────────────────────────────────────────

:cmd_build
echo ----------------------------------------
call :log "Building release binaries..."
echo ----------------------------------------
echo   cargo build --release
cargo build --release --bin ai-gateway --manifest-path "%ROOT%\Cargo.toml"
if %ERRORLEVEL% neq 0 call :die "Rust build failed"
if not exist "%BINARY%" call :die "Binary not found at %BINARY%"
call :ok "Gateway binary built"

echo   npm run build
cd /d "%DASHBOARD_DIR%" && npm run build
if %ERRORLEVEL% neq 0 call :die "Dashboard build failed"
cd /d "%ROOT%"
call :ok "Dashboard static export built"
echo ----------------------------------------
goto :eof

:: ─── start ──────────────────────────────────────────────────────────────────

:cmd_start
if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
call :pid_alive "%GW_PID_FILE%"
if !_PA_RESULT!==1 call :die "Gateway already running — use 'stop' first"
call :check_deps
call :check_ports
call :cmd_build

call :log "Starting production services..."

start "" /B "%BINARY%" > "%GW_LOG%" 2>&1
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq ai-gateway.exe" /NH') do (
    echo %%p > "%GW_PID_FILE%"
    goto gw_pid_done
)
:gw_pid_done

start "" /B npx serve "%DASHBOARD_DIR%" -p %DASHBOARD_PORT% -s > "%UI_LOG%" 2>&1
for /f "tokens=2" %%p in ('tasklist /FI "IMAGENAME eq node.exe" /NH') do (
    echo %%p > "%UI_PID_FILE%"
    goto ui_pid_done
)
:ui_pid_done

call :wait_http "http://localhost:%GATEWAY_PORT%/health" "Gateway"
call :wait_http "http://localhost:%DASHBOARD_PORT%"      "Dashboard"

echo.
echo   AI Gateway running (production)
echo.
echo   Gateway   -^> http://localhost:%GATEWAY_PORT%
echo   Dashboard -^> http://localhost:%DASHBOARD_PORT%
echo   Logs      -^> %LOG_DIR%
echo.
goto :eof

:: ─── dev ────────────────────────────────────────────────────────────────────

:cmd_dev
if not exist "%RUN_DIR%" mkdir "%RUN_DIR%"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"
call :check_deps
call :check_ports

echo.
echo   AI Gateway - dev mode
echo   Gateway   -^> http://localhost:%GATEWAY_PORT%
echo   Dashboard -^> http://localhost:%DASHBOARD_PORT%
echo   Close this window to stop
echo.

start "gateway"   cargo run --bin ai-gateway --manifest-path "%ROOT%\Cargo.toml"
start "dashboard" cmd /c "cd /d %DASHBOARD_DIR% && npm run dev"
goto :eof

:: ─── stop ───────────────────────────────────────────────────────────────────

:cmd_stop
call :log "Stopping AI Gateway stack..."
call :graceful_stop "%GW_PID_FILE%" "Gateway"
call :graceful_stop "%UI_PID_FILE%" "Dashboard"
call :log "All services stopped."
goto :eof

:: ─── status ─────────────────────────────────────────────────────────────────

:cmd_status
echo.
echo   AI Gateway status
echo.
call :pid_alive "%GW_PID_FILE%"
if !_PA_RESULT!==1 (
    echo   * Gateway    running   pid=!_PA_PID!   http://localhost:%GATEWAY_PORT%
) else (
    echo   * Gateway    stopped
)
call :pid_alive "%UI_PID_FILE%"
if !_PA_RESULT!==1 (
    echo   * Dashboard  running   pid=!_PA_PID!   http://localhost:%DASHBOARD_PORT%
) else (
    echo   * Dashboard  stopped
)
echo.
echo   Logs: %LOG_DIR%
echo.
goto :eof

:: ─── health ─────────────────────────────────────────────────────────────────

:cmd_health
echo.
echo   Health check
echo.
curl -sf "http://localhost:%GATEWAY_PORT%/health" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo   + Gateway    http://localhost:%GATEWAY_PORT%/health
) else (
    echo   x Gateway    not responding at http://localhost:%GATEWAY_PORT%/health
)
curl -sf -o nul "http://localhost:%DASHBOARD_PORT%" >nul 2>&1
if %ERRORLEVEL%==0 (
    echo   + Dashboard  http://localhost:%DASHBOARD_PORT%
) else (
    echo   x Dashboard  not responding at http://localhost:%DASHBOARD_PORT%
)
echo.
goto :eof

:: ─── release ────────────────────────────────────────────────────────────────

:cmd_release
:: Extract version from Cargo.toml
for /f "tokens=3 delims= " %%v in ('findstr /R "^version" "%ROOT%\Cargo.toml"') do (
    set RAW_VER=%%v
    goto ver_done
)
:ver_done
set VERSION=%RAW_VER:"=%

set RELEASE_NAME=ai-gateway-v%VERSION%-windows
set RELEASE_DIR=%ROOT%\releases\%RELEASE_NAME%
set ARCHIVE=%ROOT%\releases\%RELEASE_NAME%.zip

echo ----------------------------------------
call :log "Building Windows release v%VERSION%..."
echo ----------------------------------------

call :cmd_build

if exist "%RELEASE_DIR%" rmdir /s /q "%RELEASE_DIR%"
mkdir "%RELEASE_DIR%\dashboard"

copy "%BINARY%" "%RELEASE_DIR%\ai-gateway.exe" >nul
xcopy "%DASHBOARD_DIR%\out" "%RELEASE_DIR%\dashboard\" /E /I /Q >nul
copy "%ROOT%\gateway.toml" "%RELEASE_DIR%\gateway.toml" >nul

:: Write customer bat file
(
echo @echo off
echo :: AI Gateway - start the gateway and dashboard
echo :: Usage: ai-gateway.bat [gateway-port] [dashboard-port]
echo setlocal
echo set ROOT=%%~dp0
echo set ROOT=%%ROOT:~0,-1%%
echo set GATEWAY_PORT=8080
echo set DASHBOARD_PORT=3000
echo if not "%%1"=="" set GATEWAY_PORT=%%1
echo if not "%%2"=="" set DASHBOARD_PORT=%%2
echo.
echo if not exist "%%ROOT%%\gateway.toml"   echo x gateway.toml not found ^& exit /b 1
echo if not exist "%%ROOT%%\ai-gateway.exe" echo x ai-gateway.exe not found ^& exit /b 1
echo if not exist "%%ROOT%%\dashboard"      echo x dashboard\ not found ^& exit /b 1
echo.
echo echo [ai-gateway] Starting...
echo.
echo start "" /B "%%ROOT%%\ai-gateway.exe"
echo.
echo where python ^>nul 2^>^&1 ^&^& start "" /B python -m http.server %%DASHBOARD_PORT%% --directory "%%ROOT%%\dashboard" ^&^& goto serve_ok
echo where npx    ^>nul 2^>^&1 ^&^& start "" /B npx serve "%%ROOT%%\dashboard" -p %%DASHBOARD_PORT%% -s ^&^& goto serve_ok
echo echo ! Need python or npx to serve the dashboard
echo :serve_ok
echo.
echo echo   Waiting for gateway
echo for /L %%%%i in (1,1,30^) do (
echo     curl -sf -o nul --max-time 1 "http://localhost:%%GATEWAY_PORT%%/health" ^>nul 2^>^&1 ^&^& goto ready
echo     timeout /t 1 /nobreak ^>nul
echo )
echo :ready
echo echo.
echo echo   AI Gateway is running
echo echo   API        -^> http://localhost:%%GATEWAY_PORT%%
echo echo   Dashboard  -^> http://localhost:%%DASHBOARD_PORT%%
echo echo   Close this window to stop
echo pause ^>nul
) > "%RELEASE_DIR%\ai-gateway.bat"

:: Create zip using PowerShell (built into all modern Windows)
if exist "%ARCHIVE%" del /f "%ARCHIVE%"
powershell -NoProfile -Command "Compress-Archive -Path '%RELEASE_DIR%\*' -DestinationPath '%ARCHIVE%'"
if %ERRORLEVEL% neq 0 call :die "Failed to create zip archive"

echo ----------------------------------------
call :ok "Release ready: releases\%RELEASE_NAME%.zip"
echo.
echo   Contents:
echo     ai-gateway.exe  - gateway binary
echo     dashboard\      - UI static files
echo     gateway.toml    - configuration
echo     ai-gateway.bat  - start everything
echo.
echo   Customer usage:
echo     Unzip %RELEASE_NAME%.zip
echo     cd %RELEASE_NAME%
echo     Edit gateway.toml - add your provider API keys
echo     ai-gateway.bat
echo ----------------------------------------
goto :eof

:: ─── help ───────────────────────────────────────────────────────────────────

:cmd_help
echo.
echo Usage: ai-gateway.bat ^<command^>
echo.
echo Commands:
echo   start    Build release binaries then start in background
echo   dev      Start in dev mode with live reload
echo   stop     Stop all running services
echo   build    Build release binaries without starting
echo   release  Build + package distributable release zip
echo   status   Show running services and PIDs
echo   health   HTTP health checks against running services
echo.
echo Environment:
echo   GATEWAY_PORT      Gateway port       (default: 8080)
echo   DASHBOARD_PORT    Dashboard port     (default: 3000)
echo.
goto :eof
