@echo off
rem SPDX-License-Identifier: GPL-3.0-or-later
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required to start X20CTL Web.
  pause
  exit /b 1
)
node "%~dp0serve.mjs"
if errorlevel 1 pause
