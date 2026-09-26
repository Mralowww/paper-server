/* 線條圖示、自繪 16×16 像素擊殺圖示、像素世界縮圖（全部自行繪製，不使用 Mojang 素材） */
(() => {
  const P = {
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
    users: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14c2.2.6 3.5 2.6 3.5 6"/>',
    music: '<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
    cursor: '<path d="m4 4 7 17 2.5-7.5L21 11 4 4Z"/>',
    pickaxe: '<path d="M14.5 12.5 6.6 20.4a1.4 1.4 0 0 1-2-2l7.9-7.9"/><path d="M15.7 4.3A12.5 12.5 0 0 0 5.5 3a1 1 0 0 0 .1 1.7 22 22 0 0 1 6.3 3.4"/><path d="M17.7 3.7a1 1 0 0 0-1.4 0l-4.6 4.6a1 1 0 0 0 0 1.4l2.6 2.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/><path d="M19.7 8.3a12.5 12.5 0 0 1 1.3 10.2 1 1 0 0 1-1.7-.1 22 22 0 0 0-3.4-6.3"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5M21 12H9"/>',
    scissors: '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12"/>',
    paste: '<rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
    selectall: '<path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M9 9h6v6H9z"/>',
    eraser: '<path d="m7 21-4.3-4.3a1 1 0 0 1 0-1.4l10-10a1 1 0 0 1 1.4 0l5.6 5.6a1 1 0 0 1 0 1.4L12 20"/><path d="M7 21h14M9 11l6 6"/>',
    idcard: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2"/><path d="M6 16c.5-1.5 1.7-2 3-2s2.5.5 3 2M15 10h3M15 14h3"/>',
    back: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    up: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5"/>',
    login: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    pin: '<path d="M12 17v5M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Z"/>',
    gift: '<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7M7.5 8a2.5 2.5 0 0 1 0-5C11 3 12 8 12 8s1-5 4.5-5a2.5 2.5 0 0 1 0 5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5M12 15V3"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-7"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    grid: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
    ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    message: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12Z"/>',
    link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M14 9l2 2"/>',
    shield: '<path d="M12 3 4 6v6c0 4.5 3.4 8 8 9 4.6-1 8-4.5 8-9V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.9 4.9 7 7M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1 7 17M17 7l2.1-2.1"/>',
    activity: '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>',
    news: '<path d="M4 4h13v16H6a2 2 0 0 1-2-2V4Z"/><path d="M17 8h3v10a2 2 0 0 1-2 2M8 8h5M8 12h5M8 16h3"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4Z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    home: '<path d="M3 11 12 3l9 8"/><path d="M5 9.5V21h14V9.5"/>',
    bug: '<rect x="7" y="8" width="10" height="13" rx="5"/><path d="M12 8v13M9 5l1.5 2M15 5l-1.5 2M3 12h4M17 12h4M4 18l3-2M20 18l-3-2M4 6l3 3M20 6l-3 3"/>',
    scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a3.5 3.5 0 0 0 6 0L5 7ZM19 7l-3 7a3.5 3.5 0 0 0 6 0l-3-7Z"/>',
    flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3Z"/>',
    wifi: '<path d="M2 8.5a15 15 0 0 1 20 0M5.5 12a10 10 0 0 1 13 0M9 15.5a5 5 0 0 1 6 0"/><circle cx="12" cy="19" r="1"/>',
    gem: '<path d="M6 3h12l4 6-10 12L2 9l4-6Z"/><path d="M2 9h20M12 21 8 9l4-6 4 6-4 12"/>',
    dots: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
    alert: '<path d="M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
    kick: '<path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5M15 12H3"/>',
    mute: '<path d="M21 12a8 8 0 0 1-11.6 7.1L3 21l1.9-5.4A8 8 0 1 1 21 12Z"/><path d="m9.5 9.5 5 5M14.5 9.5l-5 5"/>',
    monitorx: '<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4M9.5 7.5l5 5M14.5 7.5l-5 5"/>',
    send: '<path d="m22 2-7 20-4-9-9-4 20-7Z"/><path d="M22 2 11 13"/>',
    clip: '<path d="m21 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6L15 6.6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    server: '<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M5 7l1 13h12l1-13M9 7V4h6v3"/>',
    refresh: '<path d="M21 12a9 9 0 0 1-15.5 6.2L3 16M3 12a9 9 0 0 1 15.5-6.2L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    sword: '<path d="M14.5 17.5 3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2"/>',
    code: '<path d="m8 8-5 4 5 4M16 8l5 4-5 4M14 4l-4 16"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  };
  const icon = (name, size = 18, sw = 1.8) =>
    `<svg class="ico" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || P.dots}</svg>`;

  /* 多色像素圖：grid 每個字元對應 palette 顏色，"." 為透明 */
  function pixel(grid, pal, size = 20) {
    let r = "";
    grid.forEach((row, y) => { let x = 0; while (x < row.length) { const c = row[x]; if (c === "." || !pal[c]) { x++; continue; } let w = 1; while (row[x + w] === c) w++; r += `<rect x="${x}" y="${y}" width="${w}" height="1" fill="${pal[c]}"/>`; x += w; } });
    return `<svg class="px-icon" width="${size}" height="${size}" viewBox="0 0 16 16" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }
  const KILL = {
    crystal: [["................", "......aaaa......", ".....abbbba.....", "....abbccbba....", "...abbcddcbba...", "..abbcdeedcbba..", "..abcdeeeedcba..", "..abcdeeeedcba..", "..abbcdeedcbba..", "...abbcddcbba...", "....abbccbba....", ".....abbbba.....", "......aaaa......", "....ffffffff....", "...fgggggggggf..", "................"],
      { a: "#3b2a55", b: "#8f5fd6", c: "#c29cf7", d: "#f0dcff", e: "#ffffff", f: "#2b2b30", g: "#5a5a63" }],
    anchor: [["................", ".aaaaaaaaaaaaaa.", ".abbbbbbbbbbbba.", ".ab.cc.cc.cc.ba.", ".abccccccccccba.", ".ab.cc.dd.cc.ba.", ".abcccddddcccba.", ".abccddeeddccba.", ".abccddeeddccba.", ".abcccddddcccba.", ".ab.cc.dd.cc.ba.", ".abccccccccccba.", ".ab.cc.cc.cc.ba.", ".abbbbbbbbbbbba.", ".aaaaaaaaaaaaaa.", "................"],
      { a: "#120b1c", b: "#2a1d3d", c: "#3d2a57", d: "#8a3ed6", e: "#e7b8ff" }],
    melee: [["...........aa...", "..........abba..", ".........abcba..", "........abcba...", ".......abcba....", "......abcba.....", ".....abcba......", "..d.abcba.......", "..ddbcba........", "...ddda.........", "...edd..........", "..eeddd.........", ".ee..dd.........", "ee..............", "e...............", "................"],
      { a: "#34383b", b: "#9aa3a8", c: "#e3e7e9", d: "#5a3d22", e: "#8a6238" }],
    sword: [["...........aa...", "..........abba..", ".........abcba..", "........abcba...", ".......abcba....", "......abcba.....", ".....abcba......", "..d.abcba.......", "..ddbcba........", "...ddda.........", "...edd..........", "..eeddd.........", ".ee..dd.........", "ee..............", "e...............", "................"],
      { a: "#1c3b3a", b: "#5fd6cf", c: "#c8fffb", d: "#5a3d22", e: "#8a6238" }],
    axe: [["................", "........aa......", ".......abba.....", "......abbbba....", ".....cbbbbbad...", ".....cbbbbdd....", "......cbbdd.....", ".......cde......", ".......dd.......", "......ed........", ".....dd.........", "....de..........", "...dd...........", "..ed............", ".dd.............", "................"],
      {"a": "#2f3a3d", "b": "#b9c3c7", "c": "#f4fbfc", "d": "#6b4a2a", "e": "#8a6238"}],
    spear: [["..............cc", ".............cbc", "............cbba", "...........cbba.", "..........fbaa..", ".........ff.....", "........de......", ".......dd.......", "......de........", ".....dd.........", "....de..........", "...dd...........", "..de............", ".dd.............", "de..............", "................"],
      {"a": "#5a6468", "b": "#c9d2d6", "c": "#ffffff", "d": "#6b4a2a", "e": "#8a6238", "f": "#3a3f42"}],
    trident: [["...........c...c", "..........b...b.", ".........b...b..", "........a...b...", ".........a.b...c", "..........ab..b.", ".........aba.b..", "........ab..a...", ".......ab.......", "......ab........", ".....ab.........", "....ab..........", "...ab...........", "..ab............", ".ab.............", "................"],
      {"a": "#1f5e5a", "b": "#4fb8a8", "c": "#c8fff5"}],
    bow: [["......aaa.......", ".....a...bb.....", "....a......b....", "...a........b...", "...a.........b..", "..a...........b.", "..a...cc......b.", "..a..cdddddddcb.", "..a...cc......b.", "..a...........b.", "...a.........b..", "...a........b...", "....a......b....", ".....a...bb.....", "......aaa.......", "................"],
      { a: "#8a6238", b: "#dcdcdc", c: "#9aa3a8", d: "#5a3d22" }],
    mace: [["................", ".....aaaaaa.....", "....abbbbbba....", "...abbccccbba...", "...abccccccba...", "...abccccccba...", "...abbccccbba...", "....abbbbbba....", ".....aaaaaa.....", ".......dd.......", ".......dd.......", ".......dd.......", ".......dd.......", ".......ee.......", ".......ee.......", "................"],
      { a: "#2e3336", b: "#6f787d", c: "#aab4b9", d: "#6b4a2a", e: "#3f2b18" }],
    tnt: [["................", ".aaaaaaaaaaaaaa.", ".abbbbbbbbbbbba.", ".abbbbbbbbbbbba.", ".aaaaaaaaaaaaaa.", ".cccccccccccccc.", ".cddcddcddcddcc.", ".cdccdcdcdccdcc.", ".cdccdcdcdccdcc.", ".cccccccccccccc.", ".aaaaaaaaaaaaaa.", ".abbbbbbbbbbbba.", ".abbbbbbbbbbbba.", ".aaaaaaaaaaaaaa.", "................", "................"],
      { a: "#7a1f1a", b: "#d13b30", c: "#e9e2d4", d: "#1c1c1c" }],
    fall: [["................", ".......aa.......", "......abba......", ".......aa.......", "......aaaa......", ".....a.aa.a.....", ".......aa.......", "......a..a......", ".....a....a.....", "................", "................", "cccccccccccccccc", "dddddddddddddddd", "dedddeddddeddded", "dddddddddddddddd", "................"],
      { a: "#d8d0c4", b: "#1c1c1c", c: "#5fae3e", d: "#7a5230", e: "#5a3a20" }],
    other: [["................", "....aaaaaaaa....", "...abbbbbbbbba..", "..abbbbbbbbbbba.", "..abccbbbbccbba.", "..abccbbbbccbba.", "..abbbbbbbbbbba.", "..abbbbddbbbbba.", "...abbbbbbbbba..", "....abcbcbcba...", "....abbbbbbba...", ".....aaaaaaa....", "................", "................", "................", "................"],
      { a: "#3a3d40", b: "#d7d9d4", c: "#1c1c1c", d: "#8b8f92" }],
  };
  const KILL_NAMES = { crystal: "kill.crystal", anchor: "kill.anchor", melee: "kill.melee", sword: "kill.sword", axe: "kill.axe", spear: "kill.spear", trident: "kill.trident", bow: "kill.bow", mace: "kill.mace", tnt: "kill.tnt", fall: "kill.fall", other: "kill.other" };
  const killIcon = (m, size = 20) => { const k = KILL[m] || KILL.other; return pixel(k[0], k[1], size); };

  /* 像素世界縮圖（32×20） */
  function worldArt(world = "") {
    const w = String(world).toLowerCase();
    const type = /desert|沙/.test(w) ? "desert" : /nether|地獄/.test(w) ? "nether" : /end|終界/.test(w) ? "end" : /snow|ice|雪|冰/.test(w) ? "snow" : /ocean|sea|海/.test(w) ? "ocean" : "plains";
    const S = {
      plains: { sky: ["#8fc3ef", "#b8dcf7"], ground: "#5fae3e", dirt: "#7a5230", deco: "tree" },
      desert: { sky: ["#9dccef", "#d3e8f5"], ground: "#e3cf8e", dirt: "#c9b06e", deco: "cactus" },
      snow: { sky: ["#b9d4ea", "#e1edf6"], ground: "#f4f7fa", dirt: "#8b8f92", deco: "spruce" },
      ocean: { sky: ["#86bfe9", "#bfe0f6"], ground: "#3a78c2", dirt: "#2b5d9c", deco: "wave" },
      nether: { sky: ["#3a0e0e", "#6b1a14"], ground: "#8b2a22", dirt: "#5a1712", deco: "lava" },
      end: { sky: ["#0d0a14", "#1e1630"], ground: "#e7e3b0", dirt: "#bdb67f", deco: "pillar" },
    }[type];
    let r = `<rect width="32" height="11" fill="${S.sky[0]}"/><rect y="6" width="32" height="6" fill="${S.sky[1]}"/>`;
    if (type === "end") r += `<rect x="4" y="2" width="1" height="1" fill="#fff"/><rect x="20" y="4" width="1" height="1" fill="#fff"/><rect x="27" y="1" width="1" height="1" fill="#fff"/>`;
    else if (type !== "nether") r += `<rect x="25" y="2" width="3" height="3" fill="#fff6c2"/><rect x="4" y="3" width="6" height="1" fill="#fff" opacity=".85"/><rect x="13" y="2" width="4" height="1" fill="#fff" opacity=".7"/>`;
    const hills = [0, 1, 1, 0, 0, 1, 2, 2, 1, 0, 0, 0, 1, 1, 0, 0, 1, 1, 2, 1, 0, 0, 0, 1, 1, 1, 0, 0, 1, 0, 0, 0];
    hills.forEach((h, x) => { r += `<rect x="${x}" y="${13 - h}" width="1" height="${h + 1}" fill="${S.ground}"/>`; });
    r += `<rect y="14" width="32" height="6" fill="${S.dirt}"/><rect y="13" width="32" height="1" fill="${S.ground}"/>`;
    for (let i = 0; i < 12; i++) r += `<rect x="${(i * 7) % 32}" y="${15 + (i % 4)}" width="1" height="1" fill="#000" opacity=".12"/>`;
    const deco = {
      tree: (x) => `<rect x="${x + 1}" y="9" width="1" height="4" fill="#6b4a2a"/><rect x="${x}" y="6" width="3" height="3" fill="#3f8a2e"/>`,
      cactus: (x) => `<rect x="${x}" y="8" width="1" height="5" fill="#4f8f3a"/><rect x="${x - 1}" y="9" width="1" height="2" fill="#4f8f3a"/>`,
      spruce: (x) => `<rect x="${x + 1}" y="10" width="1" height="3" fill="#5a3d22"/><rect x="${x}" y="7" width="3" height="3" fill="#2f5a3a"/><rect x="${x + 1}" y="6" width="1" height="1" fill="#2f5a3a"/>`,
      wave: (x) => `<rect x="${x}" y="12" width="3" height="1" fill="#9fd0f7"/>`,
      lava: (x) => `<rect x="${x}" y="12" width="4" height="1" fill="#f28a1e"/><rect x="${x + 1}" y="13" width="2" height="1" fill="#ffbe3d"/>`,
      pillar: (x) => `<rect x="${x}" y="3" width="2" height="10" fill="#23182f"/><rect x="${x}" y="2" width="2" height="1" fill="#c29cf7"/>`,
    }[S.deco];
    [5, 13, 24].forEach((x) => { r += deco(x); });
    return `<svg class="world-art" viewBox="0 0 32 20" preserveAspectRatio="xMidYMid slice" shape-rendering="crispEdges" aria-hidden="true">${r}</svg>`;
  }

  Object.assign(window.ART = {}, { icon, pixel, killIcon, KILL_NAMES, worldArt });
})();
