# MyPlugin

一個空白的 Paper (Minecraft) 外掛範本，使用 Java 21 + Gradle。

## 建置

```bash
cd MyPlugin
./gradlew build
```

建置完成後，jar 檔會輸出在 `build/libs/`，放入伺服器的 `plugins/` 資料夾即可。

## 專案結構

- `src/main/java/com/example/myplugin/MyPlugin.java`：外掛主類別（`onEnable` / `onDisable`）
- `src/main/resources/plugin.yml`：外掛描述檔
- `build.gradle.kts`：Gradle 建置設定，依賴 Paper API

## 下一步

在 `MyPlugin.java` 中新增指令、事件監聽器等功能。
