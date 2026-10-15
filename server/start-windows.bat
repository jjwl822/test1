@echo off
chcp 65001 > nul
title 가족 메신저 서버
cd /d "%~dp0"

where node > nul 2>&1
if errorlevel 1 (
  echo Node.js가 설치되어 있지 않습니다.
  echo https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  start https://nodejs.org
  pause
  exit /b 1
)

rem 새 버전에서 필요한 부품이 늘었을 수 있어 매번 확인합니다 (이미 있으면 금방 끝나요).
echo 필요한 부품을 확인하는 중입니다...
call npm install --omit=dev --no-audit --no-fund
if errorlevel 1 (
  echo 설치에 실패했습니다. 인터넷 연결을 확인하세요.
  pause
  exit /b 1
)

call npm start
pause
