@echo off
echo ============================================
echo    DANSDOLLAR - Git Auto Push Script
echo ============================================
echo.

REM Check if git is initialized
if not exist ".git" (
    echo Error: Not a git repository!
    echo Please run 'git init' first.
    pause
    exit /b 1
)

REM Get current branch name
for /f "tokens=*" %%i in ('git branch --show-current 2^>nul') do set "BRANCH=%%i"
if "%BRANCH%"=="" (
    echo Error: Could not determine current branch
    pause
    exit /b 1
)

REM Display current status
echo Current branch: %BRANCH%
echo.
git status --short

REM Ask for commit message
echo.
set /p COMMIT_MSG="Enter commit message: "
if "%COMMIT_MSG%"=="" (
    echo No commit message provided, using default
    set COMMIT_MSG="Auto commit: %date% %time%"
)

REM Execute git commands
echo.
echo Adding all changes...
git add .

echo.
echo Committing changes...
git commit -m "%COMMIT_MSG%"

echo.
echo Pushing to origin/%BRANCH%...
git push origin %BRANCH%

REM Check if push was successful
if %errorlevel% equ 0 (
    echo.
    echo ============================================
    echo    Successfully pushed to GitHub!
    echo ============================================
) else (
    echo.
    echo ============================================
    echo    Push failed! Check git output above.
    echo ============================================
)

pause