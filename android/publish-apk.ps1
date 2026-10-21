# Copies the built APK to the family server and writes version.json next to it, so the app's
# settings menu can tell people a new version is out. Run after ./gradlew assembleDebug.
# Remember to raise versionCode / versionName in app/build.gradle.kts before each release.
$ErrorActionPreference = 'Stop'
$gradle = Get-Content (Join-Path $PSScriptRoot 'app\build.gradle.kts') -Raw
$code = [regex]::Match($gradle, 'versionCode\s*=\s*(\d+)').Groups[1].Value
$name = [regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
$dest = 'C:\Users\jjwl8\code\03.family-messenger\server\web\app'
Copy-Item (Join-Path $PSScriptRoot 'app\build\outputs\apk\debug\app-debug.apk') (Join-Path $dest 'family.apk') -Force
[IO.File]::WriteAllText((Join-Path $dest 'version.json'), (@{ versionCode = [long]$code; versionName = $name } | ConvertTo-Json -Compress))
"published $name ($code)"
