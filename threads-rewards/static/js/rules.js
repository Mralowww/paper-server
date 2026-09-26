(() => {
  const { $, esc, api, observe } = App;

  const DEFAULT = {
    zh: `# 尊重每一位玩家
禁止辱罵、歧視、騷擾、洗頻或散布他人隱私。
請以友善的態度對待新玩家與管理團隊。
# 公平遊戲
禁止使用外掛、X-ray 材質包、自動點擊等不公平的第三方工具。
禁止利用遊戲漏洞複製物品；發現漏洞請回報管理員。
# 建築與財產
禁止破壞、偷竊或惡意改動他人建築與物品。
建造前請與既有建築保持適當距離，避免擋住他人視野。
# 伺服器效能
禁止建造會造成嚴重卡頓的大型紅石機關或無限生怪農場。
閒置時請勿長時間開啟高負載裝置。
# 其他
禁止在聊天室或 Discord 宣傳其他伺服器。
管理團隊保有最終解釋權，規則可能隨時更新。`,
    en: `# Respect everyone
No insults, discrimination, harassment, spam or sharing others' private info.
Be kind to new players and staff.
# Play fair
No hacked clients, X-ray packs, auto-clickers or other unfair third-party tools.
No duplication exploits; report bugs to staff.
# Builds and property
No griefing, stealing or tampering with other players' builds or items.
Keep a reasonable distance from existing builds.
# Server performance
No large redstone machines or farms that cause heavy lag.
Don't leave high-load machines running while AFK.
# Other
Don't advertise other servers in chat or on Discord.
Staff have the final say; rules may be updated at any time.`,
  };

  let custom = null;
  function render() {
    const text = (custom || "").trim() || DEFAULT[App.lang] || DEFAULT.zh;
    const secs = []; let cur = null;
    text.split(/\r?\n/).forEach((line) => {
      line = line.trim(); if (!line) return;
      if (line.startsWith("#")) { cur = { title: line.replace(/^#+\s*/, ""), items: [] }; secs.push(cur); }
      else { if (!cur) { cur = { title: "", items: [] }; secs.push(cur); } cur.items.push(line.replace(/^[-*]\s*/, "")); }
    });
    $("#rules").innerHTML = secs.map((s) => `<section class="rule-sec reveal"><div>${s.title ? `<h3>${esc(s.title)}</h3>` : ""}<ul>${s.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div></section>`).join("");
    observe();
  }

  document.addEventListener("app:ready", async () => {
    try { custom = (await api("/api/server", { quiet: true })).rules; } catch { /* 使用預設規則 */ }
    render();
  });
  document.addEventListener("langchange", render);
})();
