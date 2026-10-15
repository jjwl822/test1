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

if not exist node_modules (
  echo 처음 실행 준비 중입니다. 잠시만 기다려주세요...
  call npm install --omit=dev
  if errorlevel 1 (
    echo 설치에 실패했습니다. 인터넷 연결을 확인하세요.
    pause
    exit /b 1
  )
)

call npm start
pause
