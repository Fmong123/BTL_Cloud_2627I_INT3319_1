@echo off
setlocal
chcp 65001 >nul
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
pushd "%~dp0"
where python >nul 2>nul
if not errorlevel 1 (
    python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        python "%~dp0launcher\main.py" %*
        goto finished
    )
)
where py >nul 2>nul
if not errorlevel 1 (
    py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        py -3 "%~dp0launcher\main.py" %*
        goto finished
    )
)
if exist "%~dp0backend\.venv\Scripts\python.exe" (
    "%~dp0backend\.venv\Scripts\python.exe" -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>nul
    if not errorlevel 1 (
        "%~dp0backend\.venv\Scripts\python.exe" "%~dp0launcher\main.py" %*
        goto finished
    )
)
echo Can Python 3.10+ de mo launcher.
echo Cai Python tai https://www.python.org/downloads/windows/
echo Sau khi cai, mo lai MaySec.cmd.
popd
pause
exit /b 1
:finished
set "MAYSEC_EXIT_CODE=%errorlevel%"
popd
if "%~1"=="" pause
exit /b %MAYSEC_EXIT_CODE%
