@echo off
chcp 65001 > nul
rem PC를 켜고 로그인하면 가족 메신저 서버가 자동으로 켜지도록 시작프로그램에 등록합니다.
set "TARGET=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\가족 메신저 서버.bat"
(
  echo @echo off
  echo start "가족 메신저 서버" /min cmd /c ""%~dp0start-windows.bat""
) > "%TARGET%"
echo 등록했습니다. 다음에 PC를 켜면 서버가 자동으로 시작됩니다.
echo 해제하려면 이 파일을 지우세요: %TARGET%
pause
