/* 织梦 Dreamweaver v2 — 文字长出意象，鼠标可互动
   分层：纯函数（Node 可测）+ Canvas/DOM 接线（仅浏览器执行） */
(function (root) {
  'use strict';

  /* ================= 纯函数 ================= */

  // 字符串 → 32 位无符号种子
  function hashSeed(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return h >>> 0;
  }

  // mulberry32：可播种伪随机，返回 [0,1)
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // 2D 值噪声（种子确定性，返回 0..1）
  function createNoise2D(seed) {
    function hash2(x, y) {
      let h = seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
    }
    const fade = (t) => t * t * (3 - 2 * t);
    return function (x, y) {
      const ix = Math.floor(x), iy = Math.floor(y);
      const fx = x - ix, fy = y - iy;
      const sx = fade(fx), sy = fade(fy);
      const v00 = hash2(ix, iy), v10 = hash2(ix + 1, iy);
      const v01 = hash2(ix, iy + 1), v11 = hash2(ix + 1, iy + 1);
      const a = v00 + (v10 - v00) * sx;
      const b = v01 + (v11 - v01) * sx;
      return a + (b - a) * sy;
    };
  }

  // 情绪倾向：>0 温暖，<0 冷峻，0 中性
  function sentiment(text) {
    const warm = '爱喜梦光暖希望星花甜美笑安晴金虹晨春幸燃';
    const cold = '暗冷哭惧痛雨雾夜寂孤伤逝冬雪灰泪凉黑坠溺';
    let score = 0;
    for (const ch of text) {
      if (warm.indexOf(ch) >= 0) score++;
      if (cold.indexOf(ch) >= 0) score--;
    }
    return score;
  }

  // 三套完整配色（天空/星/月/草/氛围）
  const THEMES = {
    warm:   { sky: ['#2a1035', '#5a2545'], star: '#fff3d6', moon: '#ffedc9', grass: ['#3a5a3a', '#243a2a'], glow: ['#ffc97a', '#ff9e6d', '#ff7ab0', '#ffd166'] },
    cool:   { sky: ['#0a1128', '#1a2a4a'], star: '#dceeff', moon: '#e8f2ff', grass: ['#1a3a3a', '#0f2424'], glow: ['#8ecbff', '#9aa0ff', '#b78bff', '#6fd9e8'] },
    dreamy: { sky: ['#150a2e', '#2a1a4a'], star: '#f0e6ff', moon: '#f0d9ff', grass: ['#2a2a4a', '#1a1a34'], glow: ['#d0a7ff', '#a98bff', '#ffb3e0', '#8ecbff'] }
  };
  function themeFor(text) {
    const s = sentiment(text);
    return s > 0 ? THEMES.warm : s < 0 ? THEMES.cool : THEMES.dreamy;
  }
  function paletteFor(text) {
    return themeFor(text).glow;
  }

  // 关键词 → 意象
  const IMAGERY = [
    ['star', ['星', '夜', '银河', '空']],
    ['moon', ['月']],
    ['cloud', ['云', '雾']],
    ['grass', ['原野', '草', '野', '田', '草原', '麦']],
    ['mountain', ['山', '峰', '峦']],
    ['sea', ['海', '浪', '波', '潮', '洋']],
    ['rain', ['雨']],
    ['snow', ['雪']],
    ['flower', ['花']],
    ['bird', ['鸟', '燕', '雁', '鹤']],
    ['firefly', ['萤', '光']]
  ];
  function parseImagery(text) {
    const found = {};
    for (const [key, words] of IMAGERY) {
      for (const w of words) {
        if (text.indexOf(w) >= 0) { found[key] = true; break; }
      }
    }
    // 无任何天空/地面关键词时，默认：星空 + 月亮 + 原野 + 流萤
    const hasGround = ['star', 'moon', 'cloud', 'grass', 'mountain', 'sea'].some((k) => found[k]);
    if (!hasGround) { found.star = true; found.moon = true; found.grass = true; }
    return found;
  }

  // 从 URL hash 读取文字
  function textFromLocation(loc) {
    if (!loc || !loc.hash) return '';
    const raw = loc.hash.slice(1);
    try { return decodeURIComponent(raw); } catch (e) { return raw; }
  }

  /* ================= 浏览器渲染 ================= */

  function init() {
    const canvas = document.getElementById('dream');
    const input = document.getElementById('text-input');
    const generate = document.getElementById('generate');
    const save = document.getElementById('save');
    const share = document.getElementById('share');
    const hint = document.getElementById('hint');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let raf = null;
    let currentText = '流离之梦';
    const mouse = { x: -9999, y: -9999, down: false };
    const blooms = [];

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(window.innerWidth * dpr);
      canvas.height = Math.floor(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    /* ---- 生成器：预计算各意象的静态参数 ---- */
    function genStars(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: rand() * H * 0.62, r: 0.4 + rand() * 1.4, ph: rand() * 6.28, sp: 0.5 + rand() * 1.6 });
      return a;
    }
    function genGrass(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: (i / n) * W + rand() * 6 - 3, h: H * 0.14 + rand() * H * 0.16, ph: rand() * 6.28 });
      return a;
    }
    function genRain(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: rand() * H, len: 8 + rand() * 14, sp: 6 + rand() * 8 });
      return a;
    }
    function genSnow(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: rand() * H, r: 0.8 + rand() * 1.8, sp: 0.5 + rand() * 1.2, ph: rand() * 6.28 });
      return a;
    }
    function genFireflies(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ bx: rand() * W, by: H * 0.35 + rand() * H * 0.5, ph: rand() * 6.28, sp: 0.4 + rand() * 0.8, r: 1 + rand() * 1.6, ox: 0, oy: 0 });
      return a;
    }
    function genClouds(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: H * 0.1 + rand() * H * 0.22, s: 0.6 + rand() * 1.2, sp: 0.1 + rand() * 0.3 });
      return a;
    }
    function genFlowers(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: H * 0.82 + rand() * H * 0.14, s: 0.7 + rand() * 0.8, ph: rand() * 6.28 });
      return a;
    }
    function genMountains(rand, W, H) {
      const peaks = 4 + Math.floor(rand() * 4);
      const a = [];
      for (let i = 0; i < peaks; i++) a.push({ x: (i / (peaks - 1)) * W, h: H * 0.15 + rand() * H * 0.28 });
      return a;
    }
    function genBirds(rand, W, H, n) {
      const a = [];
      for (let i = 0; i < n; i++) a.push({ x: rand() * W, y: H * 0.12 + rand() * H * 0.2, sp: 0.3 + rand() * 0.5, s: 0.7 + rand() * 0.8 });
      return a;
    }

    /* ---- 绘制器 ---- */
    function drawSky(W, H, theme) {
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, theme.sky[0]);
      g.addColorStop(1, theme.sky[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    function drawMoon(moon, theme) {
      const g = ctx.createRadialGradient(moon.x, moon.y, moon.r * 0.4, moon.x, moon.y, moon.r * 3);
      g.addColorStop(0, theme.moon);
      g.addColorStop(0.4, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, moon.r * 3, 0, 6.283);
      ctx.fill();
      ctx.fillStyle = theme.moon;
      ctx.beginPath();
      ctx.arc(moon.x, moon.y, moon.r, 0, 6.283);
      ctx.fill();
    }
    function drawStars(stars, t, theme) {
      for (const s of stars) {
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * s.sp + s.ph));
        ctx.globalAlpha = tw;
        ctx.fillStyle = theme.star;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawClouds(clouds, t, theme) {
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (const c of clouds) {
        const x = (c.x + t * 20 * c.sp) % (W + 200) - 100;
        ctx.beginPath();
        ctx.ellipse(x, c.y, 60 * c.s, 16 * c.s, 0, 0, 6.283);
        ctx.ellipse(x + 34 * c.s, c.y - 10 * c.s, 40 * c.s, 14 * c.s, 0, 0, 6.283);
        ctx.ellipse(x - 36 * c.s, c.y - 6 * c.s, 34 * c.s, 12 * c.s, 0, 0, 6.283);
        ctx.fill();
      }
    }
    function drawMountains(mt, W, H, theme) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (const p of mt) ctx.lineTo(p.x, H - p.h);
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    function drawSea(W, H, t, theme) {
      const y0 = H * 0.68;
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      ctx.fillRect(0, y0, W, H - y0);
      ctx.strokeStyle = theme.glow[0];
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1.5;
      for (let r = 0; r < 3; r++) {
        ctx.beginPath();
        for (let x = 0; x <= W; x += 8) {
          const y = y0 + 8 + r * 14 + Math.sin(x * 0.02 + t * 1.2 + r) * 4;
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawGrass(grass, W, H, t, theme) {
      for (const g of grass) {
        const baseY = H - g.h * 0.15;
        const sway = Math.sin(t * 1.3 + g.ph + g.x * 0.012) * 8;
        ctx.strokeStyle = theme.grass[0];
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(g.x, baseY);
        ctx.quadraticCurveTo(g.x + sway * 0.4, baseY - g.h * 0.6, g.x + sway, baseY - g.h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawRain(rain, W, H, t, theme) {
      ctx.strokeStyle = theme.star;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1;
      for (const r of rain) {
        const y = r.y + t * 40 * r.sp;
        const yy = ((y % (H + 40)) + H + 40) % (H + 40) - 20;
        ctx.beginPath();
        ctx.moveTo(r.x, yy);
        ctx.lineTo(r.x - 3, yy + r.len);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function drawSnow(snow, W, H, t, theme) {
      ctx.fillStyle = theme.star;
      for (const s of snow) {
        const y = (s.y + t * 18 * s.sp) % H;
        const x = s.x + Math.sin(t + s.ph) * 14;
        ctx.globalAlpha = 0.7;
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, 6.283);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    function drawBirds(birds, W, H, t, theme) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 1.5;
      for (const b of birds) {
        const x = (b.x + t * 18 * b.sp) % (W + 60) - 30;
        const y = b.y + Math.sin(t + b.x) * 5;
        const s = 8 * b.s;
        ctx.beginPath();
        ctx.moveTo(x - s, y);
        ctx.quadraticCurveTo(x - s * 0.4, y - s * 0.5, x, y);
        ctx.quadraticCurveTo(x + s * 0.4, y - s * 0.5, x + s, y);
        ctx.stroke();
      }
    }
    function drawFlowers(flowers, W, H, t, theme) {
      for (const f of flowers) {
        const sway = Math.sin(t + f.ph) * 2;
        const bx = f.x + sway, by = f.y;
        ctx.strokeStyle = theme.grass[0];
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(f.x, H);
        ctx.quadraticCurveTo(bx, by + 14 * f.s, bx, by);
        ctx.stroke();
        const r = 3.5 * f.s;
        ctx.fillStyle = theme.glow[0];
        for (let p = 0; p < 5; p++) {
          const a = (p / 5) * 6.283 + f.ph;
          ctx.beginPath();
          ctx.ellipse(bx + Math.cos(a) * r, by + Math.sin(a) * r, r * 0.62, r * 0.34, a, 0, 6.283);
          ctx.fill();
        }
        ctx.fillStyle = theme.glow[3];
        ctx.beginPath();
        ctx.arc(bx, by, r * 0.4, 0, 6.283);
        ctx.fill();
      }
    }
    function drawBloom(b, t, theme) {
      const grow = Math.min(1, b.age / 1.2);
      const fade = b.age > 4 ? Math.max(0, 1 - (b.age - 4)) : 1;
      const r = 4 + grow * 10;
      const sway = Math.sin(t + b.x) * 2;
      const bx = b.x + sway, by = b.y;
      ctx.strokeStyle = theme.grass[0];
      ctx.globalAlpha = fade;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(b.x, b.y + 60);
      ctx.quadraticCurveTo(bx, by + 20, bx, by);
      ctx.stroke();
      ctx.fillStyle = theme.glow[1];
      for (let p = 0; p < 6; p++) {
        const a = (p / 6) * 6.283 + b.x;
        ctx.beginPath();
        ctx.ellipse(bx + Math.cos(a) * r, by + Math.sin(a) * r, r * 0.6, r * 0.32, a, 0, 6.283);
        ctx.fill();
      }
      ctx.fillStyle = theme.glow[3];
      ctx.beginPath();
      ctx.arc(bx, by, r * 0.4, 0, 6.283);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    function drawFireflies(ff, W, H, t, theme) {
      for (const f of ff) {
        const tx = f.bx + Math.sin(t * f.sp + f.ph) * 26;
        const ty = f.by + Math.cos(t * f.sp * 0.8 + f.ph) * 18;
        const dx = tx - mouse.x, dy = ty - mouse.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < 120 * 120) {
          const d = Math.sqrt(d2) || 1;
          f.ox += (dx / d) * (120 - d) * 0.14;
          f.oy += (dy / d) * (120 - d) * 0.14;
        }
        f.ox *= 0.9; f.oy *= 0.9;
        const x = tx + f.ox, y = ty + f.oy;
        const pulse = 0.5 + 0.5 * Math.sin(t * 2.2 + f.ph);
        const g = ctx.createRadialGradient(x, y, 0, x, y, f.r * 6);
        g.addColorStop(0, 'rgba(255,240,170,' + (0.55 + 0.4 * pulse) + ')');
        g.addColorStop(1, 'rgba(255,240,170,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, f.r * 6, 0, 6.283);
        ctx.fill();
      }
    }

    /* ---- 主循环 ---- */
    function buildDream(text) {
      if (raf) cancelAnimationFrame(raf);
      const W = window.innerWidth, H = window.innerHeight;
      const seed = hashSeed(text);
      const rand = mulberry32(seed);
      const theme = themeFor(text);
      const img = parseImagery(text);

      const stars = genStars(rand, W, H, 90);
      const grass = genGrass(rand, W, H, 120);
      const rain = genRain(rand, W, H, 150);
      const snow = genSnow(rand, W, H, 120);
      const fireflies = genFireflies(rand, W, H, 24);
      const clouds = genClouds(rand, W, H, 5);
      const birds = genBirds(rand, W, H, 4);
      const flowers = img.flower ? genFlowers(rand, W, H, 6) : [];
      const mountains = genMountains(rand, W, H);
      const moon = { x: W * (0.68 + rand() * 0.22), y: H * (0.16 + rand() * 0.1), r: Math.min(W, H) * 0.055 };

      let t = 0;
      function frame() {
        drawSky(W, H, theme);
        if (img.mountain) drawMountains(mountains, W, H, theme);
        else if (img.sea) drawSea(W, H, t, theme);
        else drawGrass(grass, W, H, t, theme);

        if (img.cloud) drawClouds(clouds, t, theme);
        if (img.moon) drawMoon(moon, theme);
        if (img.star) drawStars(stars, t, theme);
        if (img.bird) drawBirds(birds, W, H, t, theme);
        if (img.rain) drawRain(rain, W, H, t, theme);
        if (img.snow) drawSnow(snow, W, H, t, theme);
        drawFlowers(flowers, W, H, t, theme);
        if (img.firefly) drawFireflies(fireflies, W, H, t, theme);

        for (let i = blooms.length - 1; i >= 0; i--) {
          blooms[i].age += 0.016;
          if (blooms[i].age > 5) { blooms.splice(i, 1); continue; }
          drawBloom(blooms[i], t, theme);
        }

        t += 0.016;
        raf = requestAnimationFrame(frame);
      }
      raf = requestAnimationFrame(frame);
    }

    function setHint(msg) {
      hint.textContent = msg;
      clearTimeout(setHint._t);
      setHint._t = setTimeout(() => { hint.textContent = ''; }, 2200);
    }

    function generateDream() {
      const text = input.value.trim();
      if (!text) { setHint('先写下点什么吧，一句话就好'); input.focus(); return; }
      currentText = text;
      location.hash = encodeURIComponent(text);
      buildDream(text);
      setHint('梦境已生成 · 试试点击画面或移动鼠标');
    }

    function saveImage() {
      const a = document.createElement('a');
      a.download = 'dream-' + Date.now() + '.png';
      a.href = canvas.toDataURL('image/png');
      a.click();
      setHint('已保存截图');
    }

    function shareLink() {
      if (!input.value.trim()) { setHint('先生成一个梦境，再分享'); return; }
      location.hash = encodeURIComponent(input.value.trim());
      const url = location.href;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(
          () => setHint('链接已复制，发给朋友看看吧'),
          () => setHint('复制失败，链接：' + url)
        );
      } else {
        setHint('链接：' + url);
      }
    }

    // 事件
    generate.addEventListener('click', generateDream);
    save.addEventListener('click', saveImage);
    share.addEventListener('click', shareLink);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') generateDream(); });
    canvas.addEventListener('mousemove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; });
    canvas.addEventListener('touchmove', (e) => {
      const t0 = e.touches[0]; mouse.x = t0.clientX; mouse.y = t0.clientY;
    }, { passive: true });
    canvas.addEventListener('click', (e) => {
      blooms.push({ x: e.clientX, y: e.clientY, age: 0 });
    });

    let resizeTimer = null;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => { resize(); buildDream(currentText); }, 200);
    });

    resize();
    const initial = textFromLocation(location);
    if (initial) { input.value = initial; currentText = initial; }
    buildDream(currentText);
  }

  /* ================= API ================= */
  const api = {
    hashSeed, mulberry32, createNoise2D, sentiment, themeFor, paletteFor, parseImagery, textFromLocation
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.Dreamweaver = api;

  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof window !== 'undefined' ? window : globalThis);
