@echo off
setlocal

rem Absolute paths so the script can live outside the repo.
set "REPO_ROOT=C:\Users\datahat\Downloads\Projects\unreal-websocket"
set "UNREAL_EXE=C:\Users\datahat\Downloads\04-11-2025ofiice wear\04-11-2025ofiice wear\Windows\MyProject6.exe"
set "LOCAL_URL=http://localhost:5173/"

if not exist "%REPO_ROOT%" (
    echo [ERROR] Repository root not found at "%REPO_ROOT%".
    exit /b 1
)

pushd "%REPO_ROOT%" >nul
if errorlevel 1 (
    echo [ERROR] Unable to change directory to "%REPO_ROOT%".
    exit /b 1
)

if exist "%UNREAL_EXE%" (
    echo Launching Unreal experience...
    start "" "%UNREAL_EXE%"
) else (
    echo [WARN] Unreal executable not found at "%UNREAL_EXE%".
)

echo Running npm run dev from "%REPO_ROOT%"...
echo Opening %LOCAL_URL% in your browser...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%LOCAL_URL%'"
call npm run dev
set EXIT_CODE=%ERRORLEVEL%

popd >nul
exit /b %EXIT_CODE%
