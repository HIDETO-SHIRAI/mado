/* 間取りメモ　Service Worker
 *
 * ★何のために入れたか（2026-09-12）
 *
 *   このアプリは iOS の「ホーム画面に追加」で使う（index.html の
 *   apple-mobile-web-app-capable）。ところが更新を取りに行く仕組みが1つも無く、
 *   **7月末の版を9月まで掴んだまま**だった。物件一覧に新しいボタンが出ず、
 *   「過去のデータが消えた」という騒ぎになった（真因はキャッシュ）。
 *
 *   置き場が GitHub Pages なので **Cache-Control をこちらで決められない**
 *   （実測 `max-age=600` 固定。ヘッダを足す手段が無い）。
 *   だから「更新のたびに ?v=3 のような新しいリンクを配る」で凌いでいた。
 *
 *   → ここで **画面(HTML)は必ずネットワークを先に見る** ようにする。
 *     一度これが入れば、**以後は新しいリンクを配らなくても勝手に新しくなる。**
 *
 * ★方針（種類ごとに変える）
 *
 *   画面(HTML)          … ネットワーク優先。取れたら控えも更新。取れなければ控え
 *   Firebase SDK        … 控え優先。URLに版が入っており中身が変わらないため
 *   それ以外（通信など） … 何もしない。素通しさせる
 *
 *   ★Firestore/Auth の通信には**絶対に手を出さない**。横取りすると
 *    ログインやオフライン時の挙動が壊れる。navigate と gstatic だけ扱う。
 *
 * ★具合が悪くなったときの戻し方
 *
 *   **この sw.js をリポジトリから消して公開すれば、それが取り消しになる。**
 *   更新確認で404が返ると、ブラウザはこのSWの登録を自分で解除する。
 *   （ブラウザ側で消すなら、設定→サイトデータを削除／ホーム画面アプリを入れ直す）
 */

const 版 = "2026-09-12-5";
const CACHE = "madori-" + 版;

// 最初に控えておくもの。増やしすぎると入れ替えが重くなるので、起動に要る分だけ。
const 先に控える = [
  "./",
  "./index.html",
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-app.js",
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-auth.js",
  "https://www.gstatic.com/firebasejs/12.16.0/firebase-firestore.js",
];

self.addEventListener("install", (e) => {
  // 待たせずに新しいSWへ入れ替える。古いまま居座られるのがいちばん困るため。
  self.skipWaiting();
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    // 1本でもこけたら全部入らない addAll は使わない（gstaticが一時的に落ちても諦めない）
    await Promise.all(先に控える.map((u) => c.add(u).catch(() => { })));
  })());
});

self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    // 前の版の控えを片付ける
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;                    // 書き込み系は素通し
  const url = new URL(req.url);

  // ---- 画面(HTML)：ネットワーク優先 ----
  // ここが今回の肝。オンラインなら**必ず最新のHTML**が来るので、
  // 版を上げて公開するだけで全員に届く。
  if (req.mode === "navigate" || req.destination === "document") {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req, { cache: "no-store" });
        if (fresh && fresh.ok) {
          const c = await caches.open(CACHE);
          c.put("./index.html", fresh.clone());        // 圏外のときのために控える
        }
        return fresh;
      } catch {
        // 圏外。控えがあればそれを出す（真っ白よりはるかにまし）
        const c = await caches.open(CACHE);
        const 控え = await c.match("./index.html");
        if (控え) return 控え;
        return new Response(
          "<meta charset='utf-8'><p style='font:16px sans-serif;padding:24px'>" +
          "電波が届かないため開けません。電波の良い場所で一度開くと、次からは圏外でも開けます。</p>",
          { headers: { "Content-Type": "text/html; charset=utf-8" } });
      }
    })());
    return;
  }

  // ---- Firebase SDK：控え優先 ----
  // URLに 12.16.0 と版が入っていて中身が変わらないので、控えをそのまま使ってよい。
  if (url.host === "www.gstatic.com" && url.pathname.includes("/firebasejs/")) {
    e.respondWith((async () => {
      const c = await caches.open(CACHE);
      const 控え = await c.match(req);
      if (控え) return 控え;
      const res = await fetch(req);
      if (res && res.ok) c.put(req, res.clone());
      return res;
    })());
    return;
  }

  // ---- それ以外は何もしない ----
  // Firestore / Auth の通信はここに来る。横取りしないこと。
});
