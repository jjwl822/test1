#!/bin/bash
# 가족 메신저 서버 (Mac). Finder에서 더블클릭하면 실행됩니다.
cd "$(dirname "$0")"

if ! command -v node > /dev/null 2>&1; then
  echo "Node.js가 설치되어 있지 않습니다. https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요."
  open https://nodejs.org
  read -n 1 -s -r -p "아무 키나 누르면 닫힙니다."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo "처음 실행 준비 중입니다. 잠시만 기다려주세요..."
  npm install --omit=dev || { echo "설치에 실패했습니다. 인터넷 연결을 확인하세요."; read -n 1 -s -r; exit 1; }
fi

npm start
