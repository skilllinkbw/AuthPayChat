@echo off
REM PayChat release-candidate Android build (evidence-based, reproducible).
REM Requires: Node.js, Android SDK (ANDROID_HOME), a JDK (JAVA_HOME).
REM   npm install
REM   scripts\android-build.cmd [debug|release]
setlocal

set "BUILD_TYPE=%~1"
if "%BUILD_TYPE%"=="" set "BUILD_TYPE=debug"

set "ROOT=%~dp0.."

if "%JAVA_HOME%"=="" (
  if exist "%USERPROFILE%\.jdks\jbr-21.0.11" set "JAVA_HOME=%USERPROFILE%\.jdks\jbr-21.0.11"
)
if "%ANDROID_HOME%"=="" (
  if exist "%LOCALAPPDATA%\Android\Sdk" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
)
if not exist "%JAVA_HOME%\bin\java.exe" (
  echo ERROR: JDK not found. Install a JDK and set JAVA_HOME. && exit /b 2
)
if not exist "%ANDROID_HOME%\platform-tools\adb.exe" (
  echo ERROR: Android SDK not found. Install it and set ANDROID_HOME. && exit /b 2
)

echo [1/4] Building web assets (dist/web)
call npm run build:web
if errorlevel 1 (echo FAILED: web build && exit /b 1)

echo [2/4] Syncing web assets into Android project
call npx cap sync android
if errorlevel 1 (echo FAILED: capacitor sync && exit /b 1)

echo [3/4] Compiling Android %BUILD_TYPE% package
pushd "%ROOT%\android"
if "%~2"=="clean" call gradlew.bat --no-daemon clean
if "%BUILD_TYPE%"=="release" (
  call gradlew.bat --no-daemon assembleRelease
) else (
  call gradlew.bat --no-daemon assembleDebug
)
set "GRADLE_EXIT=%errorlevel%"
popd

echo [4/4] Locating APK
if "%BUILD_TYPE%"=="release" (
  for %%f in ("%ROOT%\android\app\build\outputs\apk\release\*.apk") do echo APK: %%f
) else (
  for %%f in ("%ROOT%\android\app\build\outputs\apk\debug\*.apk") do echo APK: %%f
)

echo GRADLE_EXIT=%GRADLE_EXIT%
exit /b %GRADLE_EXIT%