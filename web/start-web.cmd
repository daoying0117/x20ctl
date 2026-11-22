@echo off
rem SPDX-License-Identifier: GPL-3.0-or-later
setlocal
set "X20CTL_NODE=%~dp0..\runtime\node\node.exe"
if not exist "%X20CTL_NODE%" (
  where node.exe >nul 2>nul
  if errorlevel 1 (
    echo Use the Windows portable ZIP, or install Node.js 22 or newer for the source checkout.
    pause
    exit /b 1
  )
  set "X20CTL_NODE=node.exe"
)
"%X20CTL_NODE%" "%~dp0launch.mjs" %*
set "X20CTL_EXIT=%errorlevel%"
if not "%X20CTL_EXIT%"=="0" pause
exit /b %X20CTL_EXIT%
