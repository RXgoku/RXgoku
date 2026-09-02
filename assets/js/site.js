/* Barako. Scroll driver for the fixed cup, the ramen bowl and the whisk.
   No dependencies. Everything continuous is transform or opacity. */
(function () {
  "use strict";
  const doc = document.documentElement;
  const cuts = Array.from(document.querySelectorAll(".cut"));
  const chrome = document.getElementById("chrome");
  const bar = document.getElementById("bar");
  const brk = document.getElementById("brk");
  const bowl = brk && brk.querySelector(".bowl");
  const matchaCut = document.getElementById("matcha");
  const matchaScene = document.getElementById("matcha-scene");
  const ramenCuts = cuts.filter((c) => c.hasAttribute("data-ramen"));
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const small = window.matchMedia("(max-width: 899px)");

  if (!brk || !chrome || !bar) return;

  /* Reveal on entry. Add only, so scrolling back up does not replay. */
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); }
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
    document.querySelectorAll("[data-reveal], [data-reveal-group]").forEach((el) => io.observe(el));
  } else {
    document.querySelectorAll("[data-reveal], [data-reveal-group]").forEach((el) => el.classList.add("in"));
  }

  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  let activeIndex = -1;
  let currentDrink = brk.dataset.drink;
  let currentGround = doc.dataset.ground;

  function setGround(g) {
    if (g === currentGround) return;
    currentGround = g;
    doc.dataset.ground = g;
    chrome.className = "chrome g-" + g;
    bar.className = "bar g-" + g;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", getComputedStyle(chrome).getPropertyValue("--canvas").trim() || "#FBF1EC");
  }

  function pour(drink) {
    if (drink) brk.dataset.drink = drink;
    brk.classList.remove("pour");
    void brk.offsetWidth; // restart the animation
    brk.classList.add("pour");
  }

  function setDrink(d) {
    if (d === currentDrink) return;
    currentDrink = d;
    pour(d);
  }

  brk.querySelector(".brk-hit").addEventListener("click", () => pour());

  /* Ramen chapter geometry. */
  const stages = ["noodles", "egg", "cheese", "greens", "chicken", "chilli", "steam"];
  function setStage(n) {
    stages.forEach((s, i) => brk.classList.toggle("has-" + s, i < n));
  }

  function bowlTargetWidth(vw) {
    return small.matches ? clamp(vw * 0.44, 150, 300) : clamp(vw * 0.32, 260, 440);
  }

  let lastT = -1;
  function driveRamen(vh, vw) {
    if (!ramenCuts.length) return;
    const first = ramenCuts[0].getBoundingClientRect();
    const last = ramenCuts[ramenCuts.length - 1].getBoundingClientRect();

    // Travel in as the first ramen cut rises into view; collapse as the last one leaves.
    const tIn = clamp((vh * 0.9 - first.top) / (vh * 0.75), 0, 1);
    const tOut = clamp((last.bottom - vh * 0.15) / (vh * 0.75), 0, 1);
    const t = Math.min(tIn, tOut);

    if (t <= 0 && lastT <= 0) { return; }
    lastT = t;

    const base = brk.getBoundingClientRect();
    const rect = { w: brk.offsetWidth, h: brk.offsetHeight };
    const cs = getComputedStyle(brk);
    const right = parseFloat(cs.right) || 0;
    const bottom = parseFloat(cs.bottom) || 0;
    const baseCx = vw - right - rect.w / 2;
    const baseCy = vh - bottom - rect.h / 2;
    const targetCx = small.matches ? vw * 0.76 : vw * 0.72;
    const targetCy = vh * 0.5;
    const e = easeInOut(t);

    if (t > 0) {
      brk.classList.add("travel");
      brk.style.transform = "translate(" + lerp(0, targetCx - baseCx, e).toFixed(1) + "px, " + lerp(0, targetCy - baseCy, e).toFixed(1) + "px)";
      const m = clamp((t - 0.45) / 0.55, 0, 1);
      brk.style.setProperty("--co", String(1 - clamp(m * 1.6, 0, 1)));
      brk.style.setProperty("--cs", String(lerp(1, 0.55, m)));
      brk.style.setProperty("--bo", String(clamp(m * 1.5, 0, 1)));
      brk.style.setProperty("--bs", String(lerp(0.4, 1, m)));
      brk.style.setProperty("--bowl-w", bowlTargetWidth(vw).toFixed(0) + "px");
    } else {
      brk.classList.remove("travel");
      brk.style.transform = "";
      brk.style.removeProperty("--co"); brk.style.removeProperty("--cs");
      brk.style.removeProperty("--bo"); brk.style.removeProperty("--bs");
    }

    // One topping per cut. Progress inside each ramen cut decides the second topping.
    let stage = 0;
    ramenCuts.forEach((c, i) => {
      const r = c.getBoundingClientRect();
      const p = clamp((vh * 0.5 - r.top) / r.height, 0, 1); // 0 when the cut's top hits mid-screen
      if (p <= 0) return;
      if (i === 0) stage = Math.max(stage, 1);                 // noodles
      if (i === 1) stage = Math.max(stage, p < 0.45 ? 2 : 3);  // egg, then cheese
      if (i === 2) stage = Math.max(stage, p < 0.45 ? 5 : 6);  // greens and chicken, then chilli oil
      if (i === 3) stage = Math.max(stage, 7);                 // finished: steam
    });
    if (t < 0.3) stage = Math.min(stage, 0);
    setStage(stage);
  }

  function driveWhisk(vh) {
    if (!matchaCut || !matchaScene) return;
    const r = matchaCut.getBoundingClientRect();
    if (r.bottom < -vh || r.top > vh * 2) return;
    const wp = clamp((vh - r.top) / (vh + r.height), 0, 1);
    matchaScene.style.setProperty("--wp", wp.toFixed(4));
  }

  function findActive(vh) {
    const mid = vh * 0.5;
    for (let i = 0; i < cuts.length; i++) {
      const r = cuts[i].getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) return i;
    }
    return activeIndex < 0 ? 0 : activeIndex;
  }

  let ticking = false;
  function update() {
    ticking = false;
    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const idx = findActive(vh);
    if (idx !== activeIndex) {
      activeIndex = idx;
      const cut = cuts[idx];
      setGround(cut.dataset.ground || "blush");
      setDrink(cut.dataset.drink || currentDrink);
      brk.classList.toggle("dim", cut.hasAttribute("data-brk-dim") && !cut.hasAttribute("data-ramen"));
    }
    driveWhisk(vh);
    driveRamen(vh, vw);
  }

  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(update); }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  update();
  // Pour once on arrival, after fonts and layout settle.
  requestAnimationFrame(() => pour());
})();
