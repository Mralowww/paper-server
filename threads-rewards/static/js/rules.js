(() => {
  const { $, $$, esc, t, api, observe } = App;

  /* 規則文字格式（後台「規則」可覆寫，格式相同）：
     # 章節        ## 小節        > 公告        - 標籤：內容        段落文字
     | 違規 | 懲處（表格）        => 條件 | 結果（警告階梯）        * 備註        ! 同意聲明
     ::: medal（Medal 權益保障區塊）        `文字` = 標示重點 */
  const DEFAULT = `# 伺服器規則
> 此版本為最新版規則，此訊息以上之規則皆視為無效，並且請依此頻道之規則為準
## 遊戲機制與安全
- 新手保護期：新玩家加入後享有 \`1 小時\` 保護期，期間禁止遭到其他玩家攻擊。
- 基地與生存：允許偷襲、搶劫與拆家，玩家需自行承擔基地安全責任。
- 戰鬥登出：進入戰鬥狀態後 \`20 秒\` 內若強行離線，系統會直接判定該玩家死亡並掉落全套裝備。伺服器不承擔責任（斷線亦同）。
- 戰鬥數值調整：因應多樣化戰鬥需求，終界水晶與重生錨的傷害值已調降為原版的 \`30%\`。
- 2v2 房間：禁止使用預先設定好的珍珠點進行傳送。
## 建築與伺服器效能
- 效能維護：禁止建造會造成伺服器嚴重卡頓的設施，如過度龐大的刷怪塔、大量 TNT 或過多盔甲架。
- 掛機踢出：當伺服器滿人過久，會踢出一些單純掛機的玩家（例如在出生點掛機）。
- 崩服行為：若企圖崩服或進行 ChunkBan，依情節處 \`30 天至永久封禁\`。一般農場或建築若造成卡頓，會先通知拆除或修剪；若無法配合將強制清空，故意為之者依崩服條例處置。
## 經濟與交易
- 遊戲內交易：伺服器允許遊戲內詐騙，玩家需自行承擔交易風險，官方不予處理。
- 現金交易：嚴禁任何涉及真實貨幣的交易與條約。伺服器不承擔相關法律責任，違規者需自行承擔法律後果。
* 伺服器也同時禁止玩家私自使用現實金錢交易遊戲內物品。
## 社群規範
- 允許言論：保障言論自由，正常抱怨或適度髒話不會被禁止。
- 嚴禁言論：禁止恐嚇、歧視、騷擾、仇恨、種族言論、洗版或廣告宣傳其他伺服器。
- 隱私保護：嚴禁未經允許散布他人個資或私生活細節，違者處 \`7 天至永久禁言\`。
- 假冒行為：禁止仿冒他人身分。
- 玩家投票踢出機制：若特定玩家引發廣大爭議，經玩家投票且同意票數超過 \`60%\` 者，可決定將該玩家封禁。
## 作弊與模組規範
- 嚴禁外掛：禁止使用任何影響遊戲平衡的外掛、透視、腳本或作弊程式。若經要求拿出證據證明未開掛卻無法提供者，視同使用外掛。
- 允許之模組：允許使用小地圖等不影響極度平衡的模組。其餘模糊地帶由服主判定。
- 漏洞利用：原則上開放玩家利用 Minecraft 漏洞，但若嚴重影響他人遊玩權益者，最重可處 \`永久封禁\`。不確定是否合規的漏洞，請事先私訊管理員確認。
- 禁止模組：Freecam、XaeroPlus、Tweakeroo、Auto Totem（其他跟此類模組相似功能亦同）。
- 額外補充：發現使用隱藏外掛之工具時，將會視為隱藏外掛並 \`永久封禁\`。
! 開始遊玩即代表同意此規則
# 懲處與警告標準
## 管理員權限
管理員擁有最終裁量權，並可視情況減輕刑罰。伺服器官方保有隨時修改規則的權利。檢舉請透過開客服單或私訊管理員。
## 具體違規懲處
| PVP 相關外掛 | \`封禁 30 天\`
| 非 PVP 外掛 | \`警告 1 次至封禁 7 天\`
| 透視外掛 | \`警告 1 至 2 次\`，並銷毀所得礦物以及與透視可能有關之物
| 漏洞影響體驗 | \`封禁 30 天至永久封禁\`
| 言論違規 | 依嚴重程度處 \`禁言 1 至 7 天\` 並記 \`警告\`，極端狀況處 \`永久禁言\`
## 警告機制
* 每支警告維持 \`1 個月\`
=> 累積 2 次警告 | \`封禁 1 天\`
=> 累積 3 次警告 | \`封禁 7 天\`
=> 累積 4 次警告 | \`封禁 30 天\` 並清空背包與終界箱內容（若為隊伍成員且有權使用工倉將一併清除工倉）
## 累犯條款
- 被懲處期間再次違規且身上已有警告者：直接 \`永久封禁\`
- 被懲處期間再次違規但身上無警告者：\`加記警告 1 支\`
- 短期內重複違規者：\`加記警告 1 支\`
# 使用 Medal 保障權益
::: medal`;

  // `重點` → 標示；其餘跳脫
  const inline = (s) => esc(s).replace(/`([^`]+)`/g, (_, x) => `<mark class="rb-pill ${/永久/.test(x) ? "hot" : /封禁|禁言/.test(x) ? "warm" : ""}">${x}</mark>`);
  const splitLabel = (s) => { const m = s.match(/^(.{1,14}?)[：:]\s*(.+)$/); return m ? [m[1], m[2]] : [null, s]; };

  function parse(text) {
    const chapters = []; let ch = null; let sec = null;
    const need = () => { if (!ch) { ch = { title: "", secs: [] }; chapters.push(ch); } if (!sec) { sec = { title: "", blocks: [] }; ch.secs.push(sec); } return sec; };
    text.split(/\r?\n/).forEach((raw) => {
      const line = raw.trim(); if (!line) return;
      if (/^#\s/.test(line)) { ch = { title: line.slice(2).trim(), secs: [] }; chapters.push(ch); sec = null; return; }
      if (/^##\s/.test(line)) { if (!ch) { ch = { title: "", secs: [] }; chapters.push(ch); } sec = { title: line.slice(3).trim(), blocks: [] }; ch.secs.push(sec); return; }
      const s = need(); const last = s.blocks[s.blocks.length - 1];
      const push = (type, v) => { if (last && last.type === type && Array.isArray(last.v)) last.v.push(v); else s.blocks.push({ type, v: [v] }); };
      if (line.startsWith(">")) s.blocks.push({ type: "notice", v: line.slice(1).trim() });
      else if (line.startsWith("!")) s.blocks.push({ type: "agree", v: line.slice(1).trim() });
      else if (line.startsWith(":::")) s.blocks.push({ type: line.slice(3).trim() });
      else if (line.startsWith("=>")) push("ladder", line.slice(2).split("|").map((x) => x.trim()));
      else if (line.startsWith("|")) push("table", line.slice(1).split("|").map((x) => x.trim()));
      else if (/^[-]\s/.test(line)) push("list", line.slice(2).trim());
      else if (/^\*\s/.test(line)) s.blocks.push({ type: "note", v: line.slice(2).trim() });
      else s.blocks.push({ type: "p", v: line });
    });
    return chapters;
  }

  const ICON = ["shield", "scale", "monitorx", "flag", "alert", "key"];
  function medal() {
    const steps = [1, 2, 3, 4].map((i) => `<li><b>${esc(t("rb.medal.s" + i))}</b><span>${esc(t("rb.medal.s" + i + "d"))}</span></li>`).join("");
    return `<div class="rb-medal reveal">
      <div class="rb-medal-head"><span class="rb-medal-logo">${App.icon("gem", 26)}</span>
        <div><h4>${esc(t("rb.medal.title"))}</h4><p>${esc(t("rb.medal.lead"))}</p></div></div>
      <div class="rb-medal-grid">
        <div class="rb-medal-card"><h5>${App.icon("check", 16)} ${esc(t("rb.medal.when"))}</h5><ul>${[1, 2, 3, 4].map((i) => `<li>${esc(t("rb.medal.w" + i))}</li>`).join("")}</ul></div>
        <ol class="rb-steps">${steps}</ol>
      </div>
      <p class="rb-note">${App.icon("alert", 15)}<span>${esc(t("rb.medal.warn"))}</span></p>
      <div class="rb-medal-cta"><a class="btn primary" href="https://medal.tv" target="_blank" rel="noopener">${App.icon("external", 16)}<span>${esc(t("rb.medal.get"))}</span></a>
        <a class="btn" href="/support">${App.icon("message", 16)}<span>${esc(t("rb.medal.ticket"))}</span></a></div>
    </div>`;
  }

  function block(b) {
    switch (b.type) {
      case "notice": return `<div class="rb-notice reveal">${App.icon("flag", 18)}<p>${inline(b.v)}</p></div>`;
      case "agree": return `<div class="rb-agree reveal">${App.icon("check", 20)}<b>${inline(b.v)}</b></div>`;
      case "note": return `<p class="rb-note reveal">${App.icon("alert", 15)}<span>${inline(b.v)}</span></p>`;
      case "p": return `<p class="rb-p reveal">${inline(b.v)}</p>`;
      case "medal": return medal();
      case "list": return `<ul class="rb-list">${b.v.map((x) => { const [l, r] = splitLabel(x); return `<li class="reveal">${l ? `<b>${esc(l)}</b>` : ""}<span>${inline(r)}</span></li>`; }).join("")}</ul>`;
      case "table": return `<div class="rb-table reveal"><div class="rb-tr rb-th"><span>${esc(t("rb.violation"))}</span><span>${esc(t("rb.penalty"))}</span></div>${b.v.map(([a, c]) => `<div class="rb-tr"><span>${inline(a)}</span><span>${inline(c || "")}</span></div>`).join("")}</div>`;
      case "ladder": return `<ol class="rb-ladder">${b.v.map(([a, c], i) => `<li class="reveal" style="--i:${i}"><span class="lv">${i + 2}</span><div><b>${inline(a)}</b><span>${inline(c || "")}</span></div></li>`).join("")}</ol>`;
      default: return "";
    }
  }

  let custom = "";
  function render() {
    let text = (custom || "").trim() || DEFAULT;
    if (!/:::\s*medal/.test(text)) text += `\n# ${t("rb.medal.chapter")}\n::: medal`;
    const chapters = parse(text);
    let n = 0;
    $("#rb-content").innerHTML = (App.lang === "en" ? `<p class="rb-note">${App.icon("globe", 15)}<span>${esc(t("rb.zhOnly"))}</span></p>` : "") +
      chapters.map((c, ci) => `<section class="rb-ch" id="ch-${ci}">
        ${c.title ? `<div class="rb-ch-head reveal"><span class="no">${String(ci + 1).padStart(2, "0")}</span><h2>${esc(c.title)}</h2></div>` : ""}
        ${c.secs.map((s) => { const id = "s-" + n++; return `<div class="rb-sec" id="${id}">
          ${s.title ? `<h3 class="reveal"><span class="ic">${App.icon(ICON[(n - 1) % ICON.length], 17)}</span>${esc(s.title)}</h3>` : ""}
          ${s.blocks.map(block).join("")}</div>`; }).join("")}
      </section>`).join("");
    n = 0;
    $("#rb-toc").innerHTML = `<div class="rb-toc-in"><small>${esc(t("rb.toc"))}</small>${chapters.map((c, ci) => `
      <a href="#ch-${ci}" class="ch"><span>${String(ci + 1).padStart(2, "0")}</span>${esc(c.title || t("rb.title"))}</a>
      ${c.secs.map((s) => { const id = "s-" + n++; return s.title ? `<a href="#${id}" class="sub" data-spy="${id}">${esc(s.title)}</a>` : ""; }).join("")}`).join("")}</div>`;
    const total = chapters.reduce((a, c) => a + c.secs.length, 0);
    $("#rb-meta").innerHTML = `<span>${App.icon("news", 15)} ${chapters.length} ${esc(t("rb.chapters"))}</span><span>${App.icon("grid", 15)} ${total} ${esc(t("rb.sections"))}</span><span>${App.icon("shield", 15)} ${esc(t("rb.latest"))}</span>`;
    observe(); spy();
  }

  let spyIO;
  function spy() {
    spyIO && spyIO.disconnect();
    const links = $$("#rb-toc [data-spy]");
    spyIO = new IntersectionObserver((es) => es.forEach((e) => {
      if (!e.isIntersecting) return;
      links.forEach((a) => a.classList.toggle("active", a.dataset.spy === e.target.id));
    }), { rootMargin: "-30% 0px -60% 0px" });
    $$(".rb-sec[id]").forEach((s) => spyIO.observe(s));
  }

  // 立即顯示內建規則，不等登入狀態或伺服器狀態；若後台有自訂規則再替換
  render();
  api("/api/rules", { quiet: true }).then((d) => { const c = (d.rules || "").trim(); if (c && c !== custom) { custom = c; render(); } }).catch(() => {});
  document.addEventListener("app:ready", () => {
    $("#rb-toc").addEventListener("click", (e) => {
      const a = e.target.closest("a[href^='#']"); if (!a) return; e.preventDefault();
      document.querySelector(a.getAttribute("href"))?.scrollIntoView({ behavior: "smooth", block: "start" }); App.sfx("switch");
    });
    const top = document.querySelector(".rb-top");
    addEventListener("scroll", () => top.classList.toggle("scrolled", scrollY > 20), { passive: true });
  });
  document.addEventListener("langchange", render);
})();
