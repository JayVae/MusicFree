

直接npx react-native run-android，不需要自己编译、安装


或者手动如下：

服务端：
npx react-native start
--reset-cache

客户端
cd E:\code\github\MusicFree\android

Set-Content -Path keystore.properties -Value "RELEASE_STORE_FILE=debug.keystore`nRELEASE_STORE_PASSWORD=android`nRELEASE_KEY_ALIAS=androiddebugkey`nRELEASE_KEY_PASSWORD=android" -Encoding ASCII

.\gradlew assembleDebug

查看任务：
.\gradlew tasks --all | Select-String 'assemble'

本地开发调试流程：

```powershell
npx react-native start
adb -s <serial> reverse --no-rebind tcp:8081 tcp:8081
adb -s <serial> install -r android\app\build\outputs\apk\debug\app-arm64-v8a-debug.apk
adb -s <serial> shell am start -n fun.upup.musicfree/.MainActivity
```

