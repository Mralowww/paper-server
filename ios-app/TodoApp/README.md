# TodoApp（iOS 待辦事項 App）

使用 SwiftUI + SwiftData 開發的原生 iOS 待辦事項 App。因為建立這個專案的環境沒有
Xcode（無法產生/驗證 `.xcodeproj` 檔案），這裡提供的是完整可用的 Swift 原始碼，
請依照下方步驟在你的 Mac 上用 Xcode 建立專案並把檔案加進去，大約 2 分鐘就能跑起來。

## 功能
- 新增 / 刪除 / 勾選完成待辦事項
- 分類（個人 / 工作 / 購物 / 其他），可依分類篩選
- 可選設定到期日
- 本地端資料儲存（SwiftData，離線可用，重開 App 資料不會消失）

## 系統需求
- macOS + Xcode 15 以上
- iOS 17 以上（因使用 SwiftData）

## 建立步驟
1. 打開 Xcode → **File → New → Project**
2. 選擇 **iOS → App**，Next
3. Product Name 填 `TodoApp`，Interface 選 **SwiftUI**，Language 選 **Swift**，
   Storage 不用特別選（我們手動加 SwiftData 程式碼）
4. 建立專案後，把本資料夾（`ios-app/TodoApp/TodoApp/`）裡的檔案複製、
   覆蓋到 Xcode 新專案的 `TodoApp/` 目錄下：
   - `TodoApp.swift`（覆蓋掉 Xcode 自動產生的同名檔）
   - `ContentView.swift`（覆蓋掉 Xcode 自動產生的同名檔）
   - `Models/TodoItem.swift`
   - `Views/AddTodoView.swift`
5. 在 Xcode 專案導覽列上，對 `TodoApp` 資料夾按右鍵 → **Add Files to "TodoApp"...**，
   把 `Models` 和 `Views` 資料夾加進專案（確認勾選 "Copy items if needed"）
6. 選擇模擬器（例如 iPhone 15）或接上你的 iPhone，按 ▶️ 執行即可

## 檔案結構
```
TodoApp/
└── TodoApp/
    ├── TodoApp.swift        # App 進入點
    ├── ContentView.swift    # 主畫面（清單 + 篩選）
    ├── Models/
    │   └── TodoItem.swift   # 資料模型（SwiftData @Model）
    └── Views/
        └── AddTodoView.swift # 新增待辦表單
```

## 之後可以擴充的方向
- 推播提醒（到期日通知）
- iCloud 同步（改用 SwiftData + CloudKit）
- 小工具（Widget）顯示今日待辦
