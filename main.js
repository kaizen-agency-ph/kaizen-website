(function () {
  'use strict';
  var doc = document.documentElement;
  var RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
  var FINE = matchMedia('(hover: hover) and (pointer: fine)').matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var clamp = function (v, a, b) { return Math.min(b, Math.max(a, v)); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var vw = innerWidth, vh = innerHeight;
  var hasAnime = typeof anime === 'function';
  window.__kz = 1;

  var yr = $('#yr'); if (yr) yr.textContent = new Date().getFullYear();

  /* ---------- split hero letters ---------- */
  $$('[data-split]').forEach(function (line) {
    var out = '';
    line.childNodes.forEach(function (n) {
      if (n.nodeType === 3) {
        // words stay unbreakable so phones wrap between words, not letters
        n.textContent.split(/(\s+)/).forEach(function (w) {
          if (!w) return;
          if (/^\s+$/.test(w)) { out += ' '; return; }
          out += '<span class="wd">' + w.split('').map(function (c) { return '<span class="ch">' + c + '</span>'; }).join('') + '</span>';
        });
      } else {
        out += '<span class="ch ' + n.className + '">' + n.textContent + '</span>';
      }
    });
    line.innerHTML = out;
  });

  /* ---------- manifesto words ---------- */
  var words = [];
  $$('[data-words]').forEach(function (p) {
    var html = '';
    p.childNodes.forEach(function (n) {
      var hl = n.nodeType === 1;
      n.textContent.split(/(\s+)/).forEach(function (w) {
        if (!w) return;
        html += /^\s+$/.test(w) ? w : '<span class="w' + (hl ? ' hl' : '') + '">' + w + '</span>';
      });
    });
    p.innerHTML = html;
    words = words.concat($$('.w', p));
  });

  /* ---------- reduced motion / no anime: show everything, stop ---------- */
  if (RM || !hasAnime) {
    doc.classList.remove('anim', 'intro-on');
    $$('[data-count]').forEach(function (el) { el.textContent = (+el.dataset.count).toFixed(+(el.dataset.dec || 0)); });
    initNav(); initMenu();
    return;
  }

  /* ---------- intro ---------- */
  var intro = $('.intro'), slash = $('.intro-slash');
  var skipIntro = !doc.classList.contains('intro-on');
  var heroVid = $('.hero-media video');
  if (heroVid) { heroVid.autoplay = true; var pl = heroVid.play(); if (pl && pl.catch) pl.catch(function () {}); }

  function heroIn() {
    var tl = anime.timeline({ easing: 'easeOutExpo' });
    tl.add({ targets: '.hero h1 .ch', translateY: ['110%', '0%'], rotate: [8, 0], duration: 1300, delay: anime.stagger(28) })
      .add({ targets: '[data-hero-fade]', opacity: [0, 1], translateY: [24, 0], duration: 1100, delay: anime.stagger(110) }, '-=1000')
      .add({ targets: '.hero-media', opacity: [0, 1], scale: [1.12, 1], duration: 2200, easing: 'easeOutQuart' }, 0)
      .add({ targets: '#nav', opacity: [0, 1], translateY: ['-100%', '0%'], duration: 900, complete: function () { $('#nav').style.transform = ''; } }, 300);
  }

  if (skipIntro) {
    heroIn();
  } else {
    document.body.style.overflow = 'hidden';
    var cnt = $('.cnt', intro), c = { v: 0 };
    var tl = anime.timeline({ easing: 'easeOutExpo' });
    tl.add({ targets: '.intro .t', translateX: ['-60%', '0%'], opacity: [0, 1], duration: 1100, delay: anime.stagger(55) })
      .add({ targets: '.intro .b', translateX: ['60%', '0%'], opacity: [0, 1], duration: 1100, delay: anime.stagger(55, { from: 'last' }) }, 0)
      .add({ targets: c, v: 100, round: 1, duration: 1900, easing: 'easeInOutQuart', update: function () { cnt.textContent = String(c.v).padStart(3, '0'); } }, 0)
      .add({ targets: '.intro .a', translateY: [40, 0], opacity: [0, 1], fill: ['#ffffff', '#e8590c'], duration: 800, easing: 'easeOutBack' }, 900)
      // the slice: tops and bottoms shear apart like the logo's cut
      .add({ targets: '.intro .t', translateX: '-3%', duration: 500, easing: 'easeInOutQuart' }, 1750)
      .add({ targets: '.intro .b', translateX: '3%', duration: 500, easing: 'easeInOutQuart' }, 1750)
      .add({ targets: slash, clipPath: ['polygon(0% 100%, 0% 100%, 0% 100%, 0% 100%)', 'polygon(0% 100%, 0% 0%, 140% 0%, 100% 100%)'], duration: 700, easing: 'easeInExpo' }, 2050)
      .add({ targets: intro, opacity: 0, duration: 1, complete: function () { intro.style.display = 'none'; document.body.style.overflow = ''; if (lenis) lenis.start(); } })
      .add({ targets: slash, clipPath: 'polygon(100% 100%, 100% 0%, 140% 0%, 140% 100%)', duration: 800, easing: 'easeInOutExpo', complete: function () { slash.style.display = 'none'; } })
      .add({ duration: 1, begin: heroIn }, '-=650');
    try { sessionStorage.setItem('kz-intro', '1'); } catch (e) {}
  }

  /* ---------- smooth scroll (desktop only) ---------- */
  var lenis = null;
  if (FINE && typeof Lenis === 'function') {
    lenis = new Lenis({ duration: 1.15, smoothWheel: true });
    if (!skipIntro) lenis.stop();
    (function raf(t) { lenis.raf(t); requestAnimationFrame(raf); })(0);
  }
  $$('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href'); if (id.length < 2) id = '#top';
      var t = $(id); if (!t) return;
      e.preventDefault(); closeMenu();
      if (lenis) lenis.scrollTo(t, { offset: id === '#work' ? 0 : -40, duration: 1.6 });
      else t.scrollIntoView({ behavior: 'smooth' });
    });
  });

  /* ---------- in-view reveals ---------- */
  var io = new IntersectionObserver(function (es) {
    es.forEach(function (e) {
      if (!e.isIntersecting) return;
      var el = e.target; io.unobserve(el);
      if (el.hasAttribute('data-reveal-lines')) {
        anime({ targets: $$('.reveal-line>span, .line>span', el), translateY: ['105%', '0%'], rotate: [4, 0], duration: 1400, easing: 'easeOutExpo', delay: anime.stagger(120) });
      } else if (el.hasAttribute('data-fade')) {
        var sib = el.parentElement ? $$(':scope > [data-fade]', el.parentElement).indexOf(el) : 0;
        anime({ targets: el, opacity: [0, 1], translateY: [30, 0], duration: 1200, easing: 'easeOutExpo', delay: Math.max(0, sib) * 110 });
        $$('[data-count]', el).forEach(countUp);
      }
    });
  }, { threshold: 0.18, rootMargin: '0px 0px -8% 0px' });
  $$('[data-reveal-lines],[data-fade]').forEach(function (el) { io.observe(el); });

  function countUp(el) {
    var o = { v: 0 }, dec = +(el.dataset.dec || 0);
    anime({ targets: o, v: +el.dataset.count, duration: 2200, easing: 'easeOutExpo', update: function () { el.textContent = o.v.toFixed(dec); } });
  }

  /* ---------- scroll engine ---------- */
  var par = $$('[data-parallax]').map(function (el) { return { el: el, f: +el.dataset.parallax, host: el.parentElement }; });
  var inner = $$('[data-inner-parallax]');
  var svcs = $$('.svc');
  var workPin = $('.work-pin'), workTrack = $('.work-track'), workBar = $('.work-progress i');
  var proc = $('.process-grid'), procLine = $('.process-path line'), steps = $$('.step');
  var manifesto = $('.manifesto');
  var marquee = $('.marquee-track'), mqX = 0, mqDir = -1, lastY = scrollY, vel = 0;
  var nav = $('#nav');
  var horiz = false, workDist = 0;

  function measure() {
    vw = innerWidth; vh = innerHeight;
    horiz = vw > 720;
    if (horiz) {
      workDist = Math.max(0, workTrack.scrollWidth - vw);
      workPin.style.height = (workDist + vh) + 'px';
    } else {
      workPin.style.height = ''; workTrack.style.transform = '';
    }
  }
  measure();
  addEventListener('resize', measure);
  addEventListener('load', measure);
  if (document.fonts) document.fonts.ready.then(measure);

  function progress(el, start, end) {
    // 0 when el top hits `start`*vh, 1 when el bottom hits `end`*vh
    var r = el.getBoundingClientRect();
    return clamp((start * vh - r.top) / (r.height + (start - end) * vh), 0, 1);
  }

  function frame() {
    var y = scrollY, dy = y - lastY; lastY = y;
    vel = lerp(vel, dy, 0.12);

    // parallax layers
    for (var i = 0; i < par.length; i++) {
      var p = par[i], r = p.host.getBoundingClientRect();
      if (r.bottom < -200 || r.top > vh + 200) continue;
      var off = (r.top + r.height / 2 - vh / 2) * -p.f;
      p.el.style.transform = 'translate3d(0,' + off.toFixed(1) + 'px,0)';
    }
    inner.forEach(function (img) {
      var r = img.parentElement.getBoundingClientRect();
      if (r.bottom < 0 || r.top > vh) return;
      var t = (r.top + r.height / 2 - vh / 2) / vh;
      img.style.transform = 'translate3d(0,' + (t * -9).toFixed(2) + '%,0)';
    });

    // stacked service cards: earlier cards recede as the next one slides over
    if (vw > 980) {
      svcs.forEach(function (card, i) {
        var next = svcs[i + 1]; if (!next) return;
        var nr = next.getBoundingClientRect(), cr = card.getBoundingClientRect();
        var t = clamp(1 - (nr.top - cr.top) / cr.height, 0, 1);
        card.style.transform = 'scale(' + (1 - t * 0.06).toFixed(4) + ')';
        card.style.filter = 'brightness(' + (1 - t * 0.55).toFixed(3) + ')';
      });
    }

    // horizontal work reel
    if (horiz) {
      var wr = workPin.getBoundingClientRect();
      var wp = clamp(-wr.top / (wr.height - vh), 0, 1);
      workTrack.style.transform = 'translate3d(' + (-wp * workDist).toFixed(1) + 'px,0,0)';
      workBar.style.width = (wp * 100).toFixed(2) + '%';
    }

    // manifesto words light up
    if (words.length) {
      var mp = progress(manifesto, 0.85, 0.55);
      var lit = mp * (words.length + 6);
      for (var k = 0; k < words.length; k++) words[k].style.opacity = (0.14 + 0.86 * clamp(lit - k, 0, 1)).toFixed(3);
    }

    // process line
    var pp = progress(proc, 0.8, 0.6);
    procLine.setAttribute('stroke-dashoffset', (100 - pp * 100).toFixed(2));
    steps.forEach(function (s, i) { s.classList.toggle('on', pp >= i / steps.length + 0.02 || (i === 0 && pp > 0.01)); });

    // marquee reacts to scroll velocity + direction
    if (Math.abs(dy) > 0.5) mqDir = dy > 0 ? -1 : 1;
    mqX += mqDir * (0.6 + Math.min(Math.abs(vel) * 0.5, 14));
    var half = marquee.scrollWidth / 2;
    if (mqX <= -half) mqX += half; if (mqX > 0) mqX -= half;
    marquee.style.transform = 'translate3d(' + mqX.toFixed(1) + 'px,0,0) skewX(' + clamp(-vel * 0.25, -10, 10).toFixed(2) + 'deg)';

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* ---------- nav ---------- */
  initNav(); initMenu();

  /* ---------- logo hover: slice apart ---------- */
  var brand = $('.nav .brand');
  if (brand) brand.addEventListener('mouseenter', function () {
    anime.remove(['.nav .brand .t', '.nav .brand .b']);
    anime({ targets: '.nav .brand .t', translateX: [{ value: -6, duration: 260 }, { value: 0, duration: 700 }], easing: 'easeOutExpo', delay: anime.stagger(25) });
    anime({ targets: '.nav .brand .b', translateX: [{ value: 6, duration: 260 }, { value: 0, duration: 700 }], easing: 'easeOutExpo', delay: anime.stagger(25, { from: 'last' }) });
    anime({ targets: '.nav .brand .a', translateY: [{ value: -5, duration: 220 }, { value: 0, duration: 900, easing: 'easeOutElastic(1, .4)' }], easing: 'easeOutQuad' });
  });

  /* ---------- cursor + magnets (fine pointers only) ---------- */
  if (FINE) {
    document.body.classList.add('has-cursor');
    var cur = $('.cursor'), dot = $('.cursor-dot'), lbl = $('.lbl', cur);
    var mx = vw / 2, my = vh / 2, cx = mx, cy = my;
    addEventListener('mousemove', function (e) { mx = e.clientX; my = e.clientY; dot.style.transform = 'translate3d(' + mx + 'px,' + my + 'px,0)'; }, { passive: true });
    (function loop() { cx = lerp(cx, mx, 0.16); cy = lerp(cy, my, 0.16); cur.style.transform = 'translate3d(' + cx.toFixed(1) + 'px,' + cy.toFixed(1) + 'px,0)'; requestAnimationFrame(loop); })();
    document.addEventListener('mouseover', function (e) {
      var t = e.target.closest('a,button,.case');
      cur.classList.toggle('hover', !!t);
      var l = t && (t.dataset.cursor || (t.classList.contains('case') ? 'VIEW' : ''));
      cur.classList.toggle('has-lbl', !!l); if (l) lbl.textContent = l;
    });
    document.addEventListener('mouseleave', function () { cur.style.opacity = 0; dot.style.opacity = 0; });
    document.addEventListener('mouseenter', function () { cur.style.opacity = ''; dot.style.opacity = ''; });

    $$('.magnet').forEach(function (m) {
      m.addEventListener('mousemove', function (e) {
        var r = m.getBoundingClientRect();
        var x = (e.clientX - r.left - r.width / 2) * 0.35, y = (e.clientY - r.top - r.height / 2) * 0.45;
        anime.remove(m);
        m.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      });
      m.addEventListener('mouseleave', function () {
        anime({ targets: m, translateX: 0, translateY: 0, duration: 1100, easing: 'easeOutElastic(1, .35)' });
      });
    });

    // hero media drifts against the pointer
    var heroMedia = $('.hero-media video');
    if (heroMedia) addEventListener('mousemove', function (e) {
      if (scrollY > vh) return;
      var x = (e.clientX / vw - 0.5) * -24, y = (e.clientY / vh - 0.5) * -16;
      heroMedia.style.transform = 'translate3d(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px,0)';
    }, { passive: true });
  }

  /* ---------- helpers ---------- */
  function initNav() {
    var nav = $('#nav'), last = scrollY;
    addEventListener('scroll', function () {
      var y = scrollY;
      nav.classList.toggle('scrolled', y > 30);
      nav.classList.toggle('hide', y > last && y > 400 && !doc.classList.contains('menu-open'));
      last = y;
    }, { passive: true });
  }
  function initMenu() {
    var btn = $('.menu-btn'), menu = $('#mobile-menu');
    btn.addEventListener('click', function () {
      var open = !doc.classList.contains('menu-open');
      doc.classList.toggle('menu-open', open);
      btn.setAttribute('aria-expanded', open); menu.setAttribute('aria-hidden', !open);
      document.body.style.overflow = open ? 'hidden' : '';
      if (open && !RM && hasAnime) anime({ targets: '.mobile-menu a', translateY: [40, 0], opacity: [0, 1], duration: 900, easing: 'easeOutExpo', delay: anime.stagger(60, { start: 200 }) });
    });
    $$('a', menu).forEach(function (a) { a.addEventListener('click', closeMenu); });
  }
  function closeMenu() {
    if (!doc.classList.contains('menu-open')) return;
    doc.classList.remove('menu-open');
    $('.menu-btn').setAttribute('aria-expanded', false); $('#mobile-menu').setAttribute('aria-hidden', true);
    document.body.style.overflow = '';
  }
})();
