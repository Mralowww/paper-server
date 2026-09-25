/* Mc.Tierlist.Asia — translations. Each entry: [繁體中文, English, Tiếng Việt] */
(() => {
  const LANGS = [
    { id: 'zh-TW', label: '中文', short: '中' },
    { id: 'en', label: 'English', short: 'EN' },
    { id: 'vi', label: 'Tiếng Việt', short: 'VI' },
  ];

  const D = {
    // ---- navigation / chrome
    'nav.home': ['首頁', 'Home', 'Trang chủ'],
    'nav.rankings': ['排行榜', 'Rankings', 'Bảng xếp hạng'],
    'nav.docs': ['開發者 API', 'Developer API', 'API cho nhà phát triển'],
    'nav.admin': ['管理後台', 'Staff Panel', 'Bảng quản trị'],
    'nav.me': ['我的資料', 'My Profile', 'Hồ sơ của tôi'],
    'nav.tester': ['考官面板', 'Tester Panel', 'Bảng giám khảo'],
    'nav.search': ['搜尋玩家…', 'Search player…', 'Tìm người chơi…'],
    'nav.login': ['登入', 'Log in', 'Đăng nhập'],
    'nav.loginDiscord': ['使用 Discord 登入', 'Log in with Discord', 'Đăng nhập bằng Discord'],
    'nav.logout': ['登出', 'Log out', 'Đăng xuất'],
    'nav.menu': ['選單', 'Menu', 'Menu'],
    'nav.language': ['語言', 'Language', 'Ngôn ngữ'],
    'footer.disclaimer': ['非 Mojang / Microsoft 官方網站', 'Not affiliated with Mojang or Microsoft', 'Không liên kết với Mojang hoặc Microsoft'],
    'footer.docs': ['API 文件', 'API Docs', 'Tài liệu API'],
    'login.error.not_configured': ['伺服器尚未設定 Discord 登入。', 'Discord login is not configured on the server.', 'Máy chủ chưa cấu hình đăng nhập Discord.'],
    'login.error.invalid_state': ['登入驗證失敗，請重新嘗試。', 'Login verification failed, please try again.', 'Xác minh đăng nhập thất bại, vui lòng thử lại.'],
    'login.error.discord_failed': ['無法連線到 Discord，請稍後再試。', 'Could not reach Discord, please try again later.', 'Không thể kết nối Discord, vui lòng thử lại sau.'],

    // ---- home
    'hero.eyebrow': ['Vanilla PvP · Taiwan', 'Vanilla PvP · Taiwan', 'Vanilla PvP · Đài Loan'],
    'hero.title': ['Vanilla PvP <span class="gold">Tier 排行榜</span>', 'Vanilla PvP <span class="gold">Tier List</span>', 'Bảng xếp hạng <span class="gold">Vanilla PvP</span>'],
    'hero.lead': [
      '華人原版水晶 V2 的 Vanilla 排名，所有段位皆由考官實際測試評定。',
      'Vanilla rankings for 華人原版水晶 V2 — every tier is decided by a live test with our testers.',
      'Bảng xếp hạng Vanilla của 華人原版水晶 V2 — mọi tier đều do giám khảo kiểm tra trực tiếp.',
    ],
    'hero.cta': ['查看排行榜', 'View rankings', 'Xem bảng xếp hạng'],
    'stat.players': ['排名玩家', 'Ranked players', 'Người chơi xếp hạng'],
    'stat.tier1': ['Tier 1 玩家', 'Tier 1 players', 'Người chơi Tier 1'],
    'stat.tier2': ['Tier 2 玩家', 'Tier 2 players', 'Người chơi Tier 2'],
    'stat.tests': ['完成考試', 'Tests completed', 'Bài kiểm tra đã xong'],
    'stat.modes': ['遊戲模式', 'Game modes', 'Chế độ chơi'],
    'home.topTitle': ['Vanilla 排行前五', 'Vanilla Top 5', 'Top 5 Vanilla'],
    'home.fullBoard': ['完整排行榜 →', 'Full rankings →', 'Xem đầy đủ →'],
    'home.tierTitle': ['Tier 等級與積分', 'Tiers & points', 'Cấp bậc & điểm'],
    'home.tierNote': [
      'HT = High Tier（該級較強），LT = Low Tier。排名依積分由高到低排序，同分玩家並列同名次。',
      'HT = High Tier (stronger within the tier), LT = Low Tier. Players are ranked by points; ties share a position.',
      'HT = High Tier (mạnh hơn trong cùng bậc), LT = Low Tier. Xếp hạng theo điểm; bằng điểm thì đồng hạng.',
    ],
    'home.whyTitle': ['為社群打造', 'Built for the community', 'Xây dựng cho cộng đồng'],
    'home.f1t': ['公正的考試制度', 'Fair testing', 'Kiểm tra công bằng'],
    'home.f1d': ['考試在 Discord 進行，每一筆結果都由考官登錄並留下紀錄。', 'Tests take place on Discord; every result is logged by a tester and kept on record.', 'Bài kiểm tra diễn ra trên Discord; mọi kết quả đều do giám khảo ghi nhận và lưu lại.'],
    'home.f2t': ['即時更新', 'Live updates', 'Cập nhật tức thì'],
    'home.f2d': ['考官登錄結果後，排行榜、Discord 身分組與 API 立即同步。', 'Once a result is logged, the rankings, Discord roles and API update instantly.', 'Khi kết quả được ghi nhận, bảng xếp hạng, vai trò Discord và API cập nhật ngay.'],
    'home.f3t': ['開發者 API', 'Developer API', 'API cho nhà phát triển'],
    'home.f3d': ['使用 API Key 讀取排行榜與玩家資料，輕鬆整合 Discord Bot 或模組。', 'Read rankings and player data with an API key — perfect for Discord bots and mods.', 'Đọc bảng xếp hạng và dữ liệu người chơi bằng API key — dễ tích hợp bot Discord hoặc mod.'],

    // ---- empty states
    'empty.soonT': ['排行榜即將開放', 'Rankings coming soon', 'Bảng xếp hạng sắp ra mắt'],
    'empty.soonD': ['目前還沒有玩家上榜。完成考試後，玩家將會出現在這裡。', 'No players yet. Players appear here once they complete a test.', 'Chưa có người chơi. Người chơi sẽ xuất hiện sau khi hoàn thành bài kiểm tra.'],
    'empty.errT': ['暫時無法載入', "Couldn't load", 'Không thể tải'],
    'empty.errD': ['請稍後重新整理頁面。', 'Please refresh the page later.', 'Vui lòng tải lại trang sau.'],
    'empty.noMatchT': ['沒有符合條件的玩家', 'No matching players', 'Không có người chơi phù hợp'],
    'empty.noMatchD': ['換個篩選條件試試看。', 'Try a different filter.', 'Hãy thử bộ lọc khác.'],
    'empty.notFoundT': ['找不到這位玩家', 'Player not found', 'Không tìm thấy người chơi'],
    'empty.notFoundD': ['「{name}」尚未被列入排行榜。', '"{name}" is not on the rankings yet.', '"{name}" chưa có trên bảng xếp hạng.'],
    'page404.title': ['找不到這個頁面', 'Page not found', 'Không tìm thấy trang'],
    'page404.desc': ['你要找的頁面不存在或已被移除。', "The page you're looking for doesn't exist or was removed.", 'Trang bạn tìm không tồn tại hoặc đã bị xoá.'],
    'page404.back': ['回到首頁', 'Back to home', 'Về trang chủ'],

    // ---- rankings
    'rank.title': ['Vanilla 排行榜', 'Vanilla Rankings', 'Bảng xếp hạng Vanilla'],
    'rank.count': ['{n} 位玩家', '{n} players', '{n} người chơi'],
    'rank.allTiers': ['全部 Tier', 'All tiers', 'Tất cả tier'],
    'rank.filter': ['篩選玩家名稱…', 'Filter by name…', 'Lọc theo tên…'],
    'rank.player': ['玩家', 'Player', 'Người chơi'],
    'rank.region': ['地區', 'Region', 'Khu vực'],
    'rank.loadMore': ['載入更多', 'Load more', 'Tải thêm'],
    'common.pts': ['分', 'pts', 'điểm'],
    'common.retired': ['已退休', 'Retired', 'Đã giải nghệ'],
    'region.TW': ['台灣', 'Taiwan', 'Đài Loan'],

    // ---- player card
    'card.close': ['關閉', 'Close', 'Đóng'],
    'card.position': ['排名', 'Rank', 'Hạng'],
    'card.overall': ['總覽', 'Overall', 'Tổng'],
    'card.tiers': ['階級', 'Tiers', 'Cấp bậc'],
    'card.record': ['戰績', 'Record', 'Thành tích'],
    'card.wins': ['勝場', 'Wins', 'Thắng'],
    'card.losses': ['敗場', 'Losses', 'Thua'],
    'card.winrate': ['勝率', 'Win rate', 'Tỉ lệ thắng'],
    'card.loginToView': ['登入後即可查看勝敗場數', 'Log in to see wins and losses', 'Đăng nhập để xem số trận thắng/thua'],
    'badge.booster': ['伺服器贊助者', 'Server Booster', 'Người tăng cường máy chủ'],
    'badge.media': ['創作者', 'Content Creator', 'Nhà sáng tạo nội dung'],

    // ---- roles / levels
    'level.owner': ['最高管理', 'Owner', 'Chủ sở hữu'],
    'level.admin': ['管理員', 'Admin', 'Quản trị viên'],
    'level.moderator': ['Moderator', 'Moderator', 'Điều hành viên'],
    'level.helper': ['小幫手', 'Helper', 'Người hỗ trợ'],
    'level.member': ['成員', 'Member', 'Thành viên'],
    'level.tester': ['考官', 'Tester', 'Giám khảo'],
    'level.senior': ['高階考官', 'Senior Tester', 'Giám khảo cấp cao'],

    // ---- my profile
    'me.loginT': ['登入以查看你的資料', 'Log in to see your profile', 'Đăng nhập để xem hồ sơ'],
    'me.loginD': ['使用 Discord 登入後，可以查看你的段位、考試紀錄與冷卻時間。', 'Log in with Discord to see your tier, test history and cooldown.', 'Đăng nhập bằng Discord để xem tier, lịch sử kiểm tra và thời gian chờ.'],
    'me.notLinkedT': ['尚未綁定玩家', 'No linked player yet', 'Chưa liên kết người chơi'],
    'me.notLinkedD': ['在 Discord 伺服器申請考試並完成後，你的資料就會出現在這裡。', 'Apply for a test in our Discord server — your profile appears here after your first result.', 'Đăng ký kiểm tra trong máy chủ Discord — hồ sơ sẽ xuất hiện sau kết quả đầu tiên.'],
    'me.notInGuild': ['你還不在 Discord 伺服器中，請先加入伺服器。', "You're not in the Discord server yet — join it first.", 'Bạn chưa tham gia máy chủ Discord — hãy tham gia trước.'],
    'me.cooldown': ['考試冷卻', 'Test cooldown', 'Thời gian chờ kiểm tra'],
    'me.ready': ['可以申請考試', 'Ready to apply', 'Có thể đăng ký'],
    'me.until': ['{time}可再次申請', 'Available {time}', 'Có thể đăng ký {time}'],
    'me.openTicket': ['進行中的考試單', 'Open test ticket', 'Phiếu kiểm tra đang mở'],
    'me.openInDiscord': ['在 Discord 開啟', 'Open in Discord', 'Mở trong Discord'],
    'me.none': ['無', 'None', 'Không có'],
    'me.history': ['考試紀錄', 'Test history', 'Lịch sử kiểm tra'],
    'me.noTests': ['還沒有考試紀錄', 'No tests yet', 'Chưa có bài kiểm tra nào'],
    'me.access': ['你的身分', 'Your roles', 'Vai trò của bạn'],
    'col.date': ['日期', 'Date', 'Ngày'],
    'col.tester': ['考官', 'Tester', 'Giám khảo'],
    'col.result': ['結果', 'Result', 'Kết quả'],
    'col.score': ['比分', 'Score', 'Tỉ số'],
    'col.player': ['玩家', 'Player', 'Người chơi'],
    'col.type': ['類型', 'Type', 'Loại'],
    'col.waiting': ['等待時間', 'Waiting', 'Đã chờ'],
    'col.current': ['目前段位', 'Current tier', 'Tier hiện tại'],

    // ---- tester panel
    'tester.denied': ['只有考官可以查看這個頁面。', 'Only testers can view this page.', 'Chỉ giám khảo mới xem được trang này.'],
    'tester.total': ['累計考試', 'Total tests', 'Tổng bài kiểm tra'],
    'tester.week': ['近 7 天', 'Last 7 days', '7 ngày qua'],
    'tester.open': ['等待中的考試單', 'Open tickets', 'Phiếu đang chờ'],
    'tester.range': ['可給予段位', 'Tiers you can award', 'Tier bạn có thể trao'],
    'tester.queue': ['考試單佇列', 'Ticket queue', 'Hàng đợi phiếu'],
    'tester.none': ['目前沒有等待中的考試單 🎉', 'No open tickets 🎉', 'Không có phiếu nào đang chờ 🎉'],
    'tester.myTests': ['我的考試紀錄', 'My tests', 'Bài kiểm tra của tôi'],
    'tester.howto': ['在考試單頻道輸入 /result 即可登錄結果。', 'Use /result inside a ticket channel to log a result.', 'Dùng /result trong kênh phiếu để ghi kết quả.'],
    'kind.normal': ['普通', 'Normal', 'Thường'],
    'kind.high': ['高階', 'High', 'Cấp cao'],

    // ---- staff panel
    'admin.loginT': ['管理後台', 'Staff Panel', 'Bảng quản trị'],
    'admin.loginD': ['僅限管理團隊使用，請使用 Discord 帳號登入。', 'Staff only — please log in with Discord.', 'Chỉ dành cho đội ngũ quản trị — vui lòng đăng nhập bằng Discord.'],
    'admin.denied': ['你的帳號沒有管理後台的權限。', "Your account doesn't have access to the staff panel.", 'Tài khoản của bạn không có quyền truy cập bảng quản trị.'],
    'tab.overview': ['總覽', 'Overview', 'Tổng quan'],
    'tab.players': ['玩家管理', 'Players', 'Người chơi'],
    'tab.tests': ['考試紀錄', 'Tests', 'Bài kiểm tra'],
    'tab.keys': ['API Keys', 'API Keys', 'API Keys'],
    'tab.team': ['團隊', 'Team', 'Đội ngũ'],
    'tab.settings': ['設定', 'Settings', 'Cài đặt'],
    'tab.audit': ['操作紀錄', 'Audit log', 'Nhật ký'],
    'admin.welcome': ['歡迎回來，{name}', 'Welcome back, {name}', 'Chào mừng trở lại, {name}'],
    'admin.subtitle': ['Mc.Tierlist.Asia 管理總覽', 'Mc.Tierlist.Asia at a glance', 'Tổng quan Mc.Tierlist.Asia'],
    'admin.openTickets': ['進行中考試單', 'Open tickets', 'Phiếu đang mở'],
    'admin.activeKeys': ['啟用中 API Key', 'Active API keys', 'API key đang hoạt động'],
    'admin.apiCalls': ['API 總呼叫次數', 'Total API calls', 'Tổng lượt gọi API'],
    'admin.recent': ['最近操作', 'Recent activity', 'Hoạt động gần đây'],
    'admin.viewAll': ['查看全部', 'View all', 'Xem tất cả'],
    'admin.readOnly': ['唯讀', 'Read-only', 'Chỉ xem'],
    'admin.botOnline': ['機器人在線', 'Bot online', 'Bot đang hoạt động'],
    'admin.botOffline': ['機器人離線', 'Bot offline', 'Bot ngoại tuyến'],
    'players.count': ['共 {n} 位玩家 · Vanilla', '{n} players · Vanilla', '{n} người chơi · Vanilla'],
    'players.search': ['搜尋玩家…', 'Search players…', 'Tìm người chơi…'],
    'players.add': ['＋ 新增玩家', '＋ Add player', '＋ Thêm người chơi'],
    'players.emptyT': ['還沒有玩家', 'No players yet', 'Chưa có người chơi'],
    'players.emptyD': ['玩家完成 Discord 考試後會自動出現，也可以手動新增。', 'Players appear automatically after a Discord test, or add one manually.', 'Người chơi tự động xuất hiện sau bài kiểm tra trên Discord, hoặc thêm thủ công.'],
    'players.editTitle': ['編輯玩家 · {name}', 'Edit player · {name}', 'Sửa người chơi · {name}'],
    'players.addTitle': ['新增玩家', 'Add player', 'Thêm người chơi'],
    'players.mcName': ['Minecraft 名稱', 'Minecraft name', 'Tên Minecraft'],
    'players.uuid': ['UUID（選填）', 'UUID (optional)', 'UUID (không bắt buộc)'],
    'players.discord': ['Discord ID（選填，用於同步身分組）', 'Discord ID (optional, syncs the tier role)', 'Discord ID (không bắt buộc, để đồng bộ vai trò)'],
    'players.tier': ['Vanilla Tier', 'Vanilla Tier', 'Vanilla Tier'],
    'players.retired': ['已退休（排行榜上會標示 R）', 'Retired (shown with an R on the rankings)', 'Đã giải nghệ (hiển thị chữ R trên bảng xếp hạng)'],
    'players.deleteT': ['刪除玩家', 'Delete player', 'Xoá người chơi'],
    'players.deleteD': ['確定要將 <b>{name}</b> 從排行榜移除嗎？此操作無法復原。', 'Remove <b>{name}</b> from the rankings? This cannot be undone.', 'Xoá <b>{name}</b> khỏi bảng xếp hạng? Không thể hoàn tác.'],
    'players.resetCd': ['重置冷卻', 'Reset cooldown', 'Đặt lại thời gian chờ'],
    'players.cdReset': ['已重置 {name} 的冷卻', 'Cooldown reset for {name}', 'Đã đặt lại thời gian chờ cho {name}'],
    'players.inCooldown': ['冷卻中', 'Cooldown', 'Đang chờ'],
    'players.created': ['已新增 {name}', 'Added {name}', 'Đã thêm {name}'],
    'players.updated': ['已更新 {name}', 'Updated {name}', 'Đã cập nhật {name}'],
    'players.deleted': ['已刪除 {name}', 'Deleted {name}', 'Đã xoá {name}'],
    'col.tier': ['Tier', 'Tier', 'Tier'],
    'col.points': ['積分', 'Points', 'Điểm'],
    'col.updated': ['更新時間', 'Updated', 'Cập nhật'],
    'col.record': ['戰績', 'Record', 'Thành tích'],
    'col.name': ['名稱', 'Name', 'Tên'],
    'col.key': ['Key', 'Key', 'Key'],
    'col.status': ['狀態', 'Status', 'Trạng thái'],
    'col.calls': ['呼叫次數', 'Calls', 'Lượt gọi'],
    'col.lastUsed': ['最後使用', 'Last used', 'Dùng lần cuối'],
    'col.createdBy': ['建立者', 'Created by', 'Người tạo'],
    'col.member': ['成員', 'Member', 'Thành viên'],
    'col.roles': ['身分', 'Roles', 'Vai trò'],
    'tests.subtitle': ['最近 200 筆 Discord 考試結果', 'Latest 200 Discord test results', '200 kết quả kiểm tra gần nhất trên Discord'],
    'tests.empty': ['還沒有考試紀錄', 'No tests yet', 'Chưa có bài kiểm tra nào'],
    'keys.subtitle': ['提供給開發者讀取排行榜資料。Key 只會在建立時顯示一次。', 'Give developers read access to the rankings. A key is shown only once, when created.', 'Cấp quyền đọc bảng xếp hạng cho nhà phát triển. Key chỉ hiển thị một lần khi tạo.'],
    'keys.create': ['＋ 建立 Key', '＋ Create key', '＋ Tạo key'],
    'keys.createTitle': ['建立 API Key', 'Create API key', 'Tạo API key'],
    'keys.nameLabel': ['名稱（用途 / 開發者）', 'Name (purpose / developer)', 'Tên (mục đích / nhà phát triển)'],
    'keys.namePh': ['例如：Discord Bot - 小明', 'e.g. Discord bot – Alex', 'Ví dụ: Bot Discord – Minh'],
    'keys.emptyT': ['尚未建立 API Key', 'No API keys yet', 'Chưa có API key'],
    'keys.emptyD': ['建立一把 Key 並交給開發者，他們就能透過 /api/v1 讀取資料。', 'Create a key and hand it to a developer so they can use /api/v1.', 'Tạo một key và gửi cho nhà phát triển để dùng /api/v1.'],
    'keys.active': ['啟用中', 'Active', 'Đang hoạt động'],
    'keys.revoked': ['已停用', 'Revoked', 'Đã thu hồi'],
    'keys.enable': ['啟用', 'Enable', 'Bật'],
    'keys.disable': ['停用', 'Disable', 'Tắt'],
    'keys.createdT': ['API Key 已建立', 'API key created', 'Đã tạo API key'],
    'keys.createdD': ['請立即複製並妥善保存。關閉視窗後將<b style="color:var(--gold-2)">無法再次查看</b>這把 Key。', 'Copy it now and keep it safe — you <b style="color:var(--gold-2)">won\'t be able to see it again</b>.', 'Hãy sao chép và lưu lại ngay — bạn <b style="color:var(--gold-2)">sẽ không xem lại được</b>.'],
    'keys.saved': ['我已保存', "I've saved it", 'Tôi đã lưu'],
    'keys.deleteT': ['刪除 API Key', 'Delete API key', 'Xoá API key'],
    'keys.deleteD': ['刪除後使用這把 Key 的程式將立即無法存取 API。', 'Apps using this key will immediately lose API access.', 'Ứng dụng dùng key này sẽ mất quyền truy cập API ngay lập tức.'],
    'keys.toastRevoked': ['已停用 Key', 'Key disabled', 'Đã tắt key'],
    'keys.toastRestored': ['已啟用 Key', 'Key enabled', 'Đã bật key'],
    'keys.toastDeleted': ['已刪除 Key', 'Key deleted', 'Đã xoá key'],
    'team.subtitle': ['權限依 Discord 身分組自動同步，請在 Discord 伺服器中調整。', 'Access follows Discord roles automatically — change roles in the Discord server.', 'Quyền truy cập tự đồng bộ theo vai trò Discord — hãy chỉnh vai trò trong máy chủ Discord.'],
    'team.empty': ['機器人上線後會自動同步團隊成員。', 'Team members sync automatically once the bot is online.', 'Thành viên sẽ tự đồng bộ khi bot hoạt động.'],
    'settings.subtitle': ['Discord 機器人狀態與考試設定', 'Discord bot status and test settings', 'Trạng thái bot Discord và cài đặt kiểm tra'],
    'settings.bot': ['機器人', 'Bot', 'Bot'],
    'settings.notConfigured': ['尚未設定（缺少 DISCORD_BOT_TOKEN / DISCORD_GUILD_ID）', 'Not configured (missing DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)', 'Chưa cấu hình (thiếu DISCORD_BOT_TOKEN / DISCORD_GUILD_ID)'],
    'settings.resultChannel': ['考試結果頻道', 'Result channel', 'Kênh kết quả'],
    'settings.applyChannel': ['申請按鈕頻道', 'Apply button channel', 'Kênh nút đăng ký'],
    'settings.category': ['考試單類別', 'Ticket category', 'Danh mục phiếu'],
    'settings.cooldown': ['考試冷卻', 'Test cooldown', 'Thời gian chờ'],
    'settings.days': ['{n} 天', '{n} days', '{n} ngày'],
    'settings.notSet': ['尚未設定', 'Not set', 'Chưa đặt'],
    'settings.howto': ['在 Discord 使用 <code>/setuptier</code> 設定結果頻道、<code>/setupapply</code> 放置申請按鈕。', 'Use <code>/setuptier</code> in Discord to set the result channel and <code>/setupapply</code> to post the apply button.', 'Dùng <code>/setuptier</code> trên Discord để đặt kênh kết quả và <code>/setupapply</code> để đăng nút đăng ký.'],
    'audit.subtitle': ['最近 200 筆操作', 'Latest 200 actions', '200 thao tác gần nhất'],
    'audit.empty': ['尚無紀錄', 'Nothing yet', 'Chưa có'],
    'common.edit': ['編輯', 'Edit', 'Sửa'],
    'common.delete': ['刪除', 'Delete', 'Xoá'],
    'common.cancel': ['取消', 'Cancel', 'Huỷ'],
    'common.confirm': ['確定', 'Confirm', 'Xác nhận'],
    'common.save': ['儲存', 'Save', 'Lưu'],
    'common.add': ['新增', 'Add', 'Thêm'],
    'common.create': ['建立', 'Create', 'Tạo'],
    'common.copy': ['複製', 'Copy', 'Sao chép'],
    'common.copied': ['已複製 ✓', 'Copied ✓', 'Đã sao chép ✓'],
    'common.copyFailed': ['複製失敗，請手動選取', 'Copy failed — select it manually', 'Sao chép thất bại — hãy chọn thủ công'],
    'common.loadFailed': ['載入失敗', 'Failed to load', 'Tải thất bại'],
    'common.error': ['發生錯誤', 'Something went wrong', 'Đã xảy ra lỗi'],
    'common.you': ['（你）', '(you)', '(bạn)'],
    'error.invalid_name': ['玩家名稱需為 2–16 個英數字或底線', 'Names must be 2–16 letters, numbers or underscores', 'Tên phải gồm 2–16 chữ cái, số hoặc dấu gạch dưới'],
    'error.invalid_uuid': ['UUID 格式不正確', 'Invalid UUID', 'UUID không hợp lệ'],
    'error.invalid_tier': ['請選擇 Tier', 'Please pick a tier', 'Vui lòng chọn tier'],
    'error.invalid_discord_id': ['Discord ID 格式不正確', 'Invalid Discord ID', 'Discord ID không hợp lệ'],
    'error.player_exists': ['此玩家已存在', 'This player already exists', 'Người chơi này đã tồn tại'],
    'error.name_taken': ['已有其他玩家使用這個名稱', 'Another player already uses this name', 'Tên này đã được người chơi khác sử dụng'],
    'error.invalid_key_name': ['請輸入 1–48 字的名稱', 'Enter a name of 1–48 characters', 'Nhập tên dài 1–48 ký tự'],
    'error.forbidden': ['你沒有權限執行此操作', "You don't have permission to do that", 'Bạn không có quyền thực hiện thao tác này'],
    'action.login': ['登入網站', 'logged in', 'đã đăng nhập'],
    'action.player_create': ['新增玩家', 'added player', 'đã thêm người chơi'],
    'action.player_update': ['更新玩家', 'updated player', 'đã cập nhật người chơi'],
    'action.player_delete': ['刪除玩家', 'deleted player', 'đã xoá người chơi'],
    'action.cooldown_reset': ['重置冷卻', 'reset cooldown', 'đã đặt lại thời gian chờ'],
    'action.key_create': ['建立 API Key', 'created API key', 'đã tạo API key'],
    'action.key_revoke': ['停用 API Key', 'disabled API key', 'đã tắt API key'],
    'action.key_restore': ['啟用 API Key', 'enabled API key', 'đã bật API key'],
    'action.key_delete': ['刪除 API Key', 'deleted API key', 'đã xoá API key'],
    'action.test_result': ['登錄考試結果', 'logged a test result', 'đã ghi kết quả kiểm tra'],
    'action.ticket_open': ['開啟考試單', 'opened a test ticket', 'đã mở phiếu kiểm tra'],
    'action.ticket_close': ['關閉考試單', 'closed a test ticket', 'đã đóng phiếu kiểm tra'],
    'action.setup_result_channel': ['設定結果頻道', 'set the result channel', 'đã đặt kênh kết quả'],
    'action.setup_apply': ['設定申請按鈕', 'set up the apply button', 'đã đặt nút đăng ký'],
    'action.roleup': ['使用 /roleup 恢復身分組', 'restored roles with /roleup', 'đã khôi phục vai trò bằng /roleup'],
    'action.roleup_approve': ['核准管理身分組恢復', 'approved a staff role restore', 'đã duyệt khôi phục vai trò quản trị'],
    'action.roleup_deny': ['拒絕管理身分組恢復', 'denied a staff role restore', 'đã từ chối khôi phục vai trò quản trị'],

    // ---- docs
    'docs.title': ['開發者 API', 'Developer API', 'API cho nhà phát triển'],
    'docs.intro': ['透過 REST API 讀取 Mc.Tierlist.Asia 的排行榜與玩家資料。所有回應皆為 JSON。', 'Read Mc.Tierlist.Asia rankings and player data through a REST API. All responses are JSON.', 'Đọc bảng xếp hạng và dữ liệu người chơi Mc.Tierlist.Asia qua REST API. Mọi phản hồi đều là JSON.'],
    'docs.nav.auth': ['驗證', 'Authentication', 'Xác thực'],
    'docs.nav.limits': ['速率限制', 'Rate limits', 'Giới hạn tốc độ'],
    'docs.nav.stats': ['統計', 'Stats', 'Thống kê'],
    'docs.nav.modes': ['模式與 Tier', 'Modes & tiers', 'Chế độ & tier'],
    'docs.nav.rankings': ['排行榜', 'Rankings', 'Bảng xếp hạng'],
    'docs.nav.player': ['玩家查詢', 'Player lookup', 'Tra cứu người chơi'],
    'docs.nav.errors': ['錯誤碼', 'Errors', 'Mã lỗi'],
    'docs.nav.examples': ['範例程式', 'Examples', 'Ví dụ'],
    'docs.auth': ['每個請求都必須附上 API Key。請聯絡管理員申請，Key 只會在建立時顯示一次，請妥善保存，不要公開在前端程式碼中。', 'Every request must include an API key. Ask a staff member for one — it is shown only once, so keep it safe and never expose it in front-end code.', 'Mọi yêu cầu phải kèm API key. Hãy xin key từ quản trị viên — key chỉ hiển thị một lần, hãy giữ an toàn và không để lộ trong mã front-end.'],
    'docs.authAlt': ['也可以使用 <code>Authorization: Bearer &lt;key&gt;</code>。', 'You can also use <code>Authorization: Bearer &lt;key&gt;</code>.', 'Bạn cũng có thể dùng <code>Authorization: Bearer &lt;key&gt;</code>.'],
    'docs.limits': ['每把 Key 每分鐘最多 60 次請求。回應標頭會包含：', 'Each key may make up to 60 requests per minute. Responses include:', 'Mỗi key được gửi tối đa 60 yêu cầu mỗi phút. Phản hồi bao gồm:'],
    'docs.th.header': ['Header', 'Header', 'Header'],
    'docs.th.desc': ['說明', 'Description', 'Mô tả'],
    'docs.th.param': ['參數', 'Parameter', 'Tham số'],
    'docs.th.status': ['狀態', 'Status', 'Mã'],
    'docs.th.points': ['積分', 'Points', 'Điểm'],
    'docs.rl.limit': ['每分鐘上限', 'Requests allowed per minute', 'Số yêu cầu tối đa mỗi phút'],
    'docs.rl.remaining': ['本分鐘剩餘次數', 'Requests left this minute', 'Số yêu cầu còn lại trong phút này'],
    'docs.rl.reset': ['重置時間（Unix 秒）', 'Reset time (Unix seconds)', 'Thời điểm đặt lại (giây Unix)'],
    'docs.ep.stats': ['網站整體統計', 'Site-wide statistics', 'Thống kê toàn trang'],
    'docs.ep.modes': ['可用模式、Tier 積分表與地區代碼', 'Modes, tier points and region codes', 'Chế độ, điểm tier và mã khu vực'],
    'docs.ep.rankings': ['依積分排序的玩家列表', 'Players sorted by points', 'Danh sách người chơi theo điểm'],
    'docs.ep.alias': ['同上（Vanilla 排行榜的別名）', 'Same as above (alias for the Vanilla rankings)', 'Như trên (bí danh của bảng xếp hạng Vanilla)'],
    'docs.ep.player': ['單一玩家資料（不分大小寫）', 'A single player (case-insensitive)', 'Một người chơi (không phân biệt hoa thường)'],
    'docs.p.limit': ['每頁筆數，1–100，預設 50', 'Page size, 1–100, default 50', 'Số mục mỗi trang, 1–100, mặc định 50'],
    'docs.p.offset': ['略過筆數，預設 0', 'Items to skip, default 0', 'Số mục bỏ qua, mặc định 0'],
    'docs.p.region': ['地區代碼，目前只有 <code>TW</code>（台灣）', 'Region code — currently only <code>TW</code> (Taiwan)', 'Mã khu vực — hiện chỉ có <code>TW</code> (Đài Loan)'],
    'docs.p.tier': ['精確 Tier（<code>HT1</code>）或 Tier 群組（<code>1</code> = HT1 + LT1）', 'Exact tier (<code>HT1</code>) or tier group (<code>1</code> = HT1 + LT1)', 'Tier chính xác (<code>HT1</code>) hoặc nhóm tier (<code>1</code> = HT1 + LT1)'],
    'docs.p.search': ['玩家名稱關鍵字', 'Name contains', 'Từ khoá trong tên'],
    'docs.playerNote': ['回應格式與排行榜中的單一玩家物件相同；找不到時回傳 <code>404 player_not_found</code>。', 'Same shape as a player in the rankings; returns <code>404 player_not_found</code> if missing.', 'Cùng định dạng với một người chơi trong bảng xếp hạng; trả về <code>404 player_not_found</code> nếu không có.'],
    'docs.err.missing': ['沒有附上 API Key', 'No API key sent', 'Không gửi API key'],
    'docs.err.invalid': ['Key 錯誤或已被停用', 'Key is wrong or disabled', 'Key sai hoặc đã bị tắt'],
    'docs.err.region': ['地區代碼錯誤', 'Unknown region code', 'Mã khu vực không hợp lệ'],
    'docs.err.notFound': ['找不到玩家', 'Player not found', 'Không tìm thấy người chơi'],
    'docs.err.rate': ['超過速率限制，請依 <code>Retry-After</code> 等待', 'Rate limited — wait for <code>Retry-After</code> seconds', 'Vượt giới hạn — hãy đợi theo <code>Retry-After</code>'],
    'docs.warn': ['請勿在瀏覽器前端直接使用 API Key，否則任何人都能看到並濫用你的 Key。請從你自己的伺服器或 Bot 呼叫 API。', 'Never use your API key in browser code — anyone could see and abuse it. Call the API from your own server or bot.', 'Đừng dùng API key trong mã trình duyệt — bất kỳ ai cũng có thể thấy và lạm dụng. Hãy gọi API từ máy chủ hoặc bot của bạn.'],
  };

  const IDX = { 'zh-TW': 0, en: 1, vi: 2 };
  let lang = 'zh-TW';
  try {
    const saved = localStorage.getItem('mctl-lang');
    if (saved && saved in IDX) lang = saved;
  } catch { /* storage unavailable */ }
  document.documentElement.lang = lang;

  function t(key, vars) {
    const entry = D[key];
    let s = entry ? (entry[IDX[lang]] ?? entry[0]) : key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
    return s;
  }
  const has = (key) => key in D;

  /** Fills [data-i18n] (text), [data-i18n-html] (markup) and [data-i18n-ph] (placeholder) under root. */
  function apply(root = document) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  }

  function setLang(next) {
    if (!(next in IDX) || next === lang) return;
    try { localStorage.setItem('mctl-lang', next); } catch { /* ignore */ }
    location.reload();
  }

  const locale = () => (lang === 'zh-TW' ? 'zh-TW' : lang);

  function fmtDate(ms) {
    return ms ? new Date(ms).toLocaleString(locale(), { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  }

  function fmtRelative(ms) {
    const diff = (ms - Date.now()) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale(), { numeric: 'auto' });
    const units = [['day', 86400], ['hour', 3600], ['minute', 60]];
    for (const [unit, sec] of units) if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
    return rtf.format(Math.round(diff), 'second');
  }

  window.I18N = { t, has, apply, setLang, fmtDate, fmtRelative, LANGS, get lang() { return lang; } };
})();
