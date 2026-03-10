const TOTAL_FRAMES = 226;
const FRAME_PATH = (n) => `scrolling_img/frame_${String(n).padStart(6, "0")}.webp`;

const canvas = document.getElementById("bg-canvas");
const ctx = canvas.getContext("2d", { alpha: false });
const bgOverlay = document.querySelector(".bg-overlay");
const fxCanvas = document.getElementById("fx-canvas");
const fxCtx = fxCanvas.getContext("2d");
const panels = Array.from(document.querySelectorAll("[data-panel]"));
const heroTitle = document.querySelector("[data-hero-title]");
const detailPanels = Array.from(document.querySelectorAll("[data-detail]"));
const detailFooter = document.querySelector("[data-detail-footer]");
const staticImageSources = Array.from(
  new Set(
    Array.from(document.images)
      .map((img) => img.currentSrc || img.src)
      .filter(Boolean)
  )
);
const styleCache = new WeakMap();

const SNAP_STOP_DEBOUNCE_MS = 130;
const SNAP_MIN_ANIMATION_MS = 2000;
const SNAP_MAX_ANIMATION_MS = 3600;
const SNAP_MS_PER_VIEWPORT = 1200;
const SNAP_LOCK_BUFFER_MS = 120;
const SNAP_PROGRESS_BIAS = 0.14;
const SNAP_VELOCITY_THRESHOLD = 0.2;

let detailStarts = [];
let panelAnchors = [];
const fireworks = [];
const fireworkColors = ["#ffd166", "#f15bb5", "#9b5de5", "#00bbf9"];
let fxRunning = false;

let lockedViewportWidth = window.innerWidth;
let lockedViewportHeight = window.innerHeight;
let lockedOrientation = "portrait";

let lastScrollY = window.scrollY;
let lastScrollTime = performance.now();
let scrollVelocity = 0;
let scrollIntent = 0;
let stopTimer = 0;
let snapLock = false;
let lastSnapTarget = -1;
let lastSnapAt = 0;
let lastSnapDuration = SNAP_MIN_ANIMATION_MS;
let snapAnimationFrame = 0;
let snapAnimating = false;

const frameStore = new Array(TOTAL_FRAMES);
let currentFrame = 0;
let ticking = false;

if ("scrollRestoration" in window.history) {
  window.history.scrollRestoration = "manual";
}

window.scrollTo(0, 0);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function setStyleVar(element, name, value) {
  let cache = styleCache.get(element);
  if (!cache) {
    cache = {};
    styleCache.set(element, cache);
  }

  if (cache[name] === value) return;
  element.style.setProperty(name, value);
  cache[name] = value;
}

function refreshDetailStarts() {
  detailStarts = detailPanels.map((panel) => panel.offsetTop);
}

function refreshPanelAnchors() {
  panelAnchors = panels.map((panel) => Math.round(panel.offsetTop));
}

function getOrientation() {
  return window.innerWidth >= window.innerHeight ? "landscape" : "portrait";
}

function lockViewportSize() {
  lockedViewportWidth = window.innerWidth;
  lockedViewportHeight = window.innerHeight;
  lockedOrientation = getOrientation();
  document.documentElement.style.setProperty("--view-height", `${lockedViewportHeight}px`);
}

function updateRatioScale() {
  const ratio = lockedViewportWidth / Math.max(lockedViewportHeight, 1);
  const scale = clamp(ratio / 1.78, 0.86, 1.16);
  document.documentElement.style.setProperty("--ratio-scale", scale.toFixed(3));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function drawStar(context, x, y, outerRadius, innerRadius, points) {
  context.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (Math.PI * i) / points - Math.PI / 2;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;

    if (i === 0) {
      context.moveTo(px, py);
    } else {
      context.lineTo(px, py);
    }
  }
  context.closePath();
}

function spawnFirework(x, y) {
  const count = Math.floor(randomBetween(14, 21));

  for (let i = 0; i < count; i += 1) {
    const angle = randomBetween(0, Math.PI * 2);
    const speed = randomBetween(1.2, 4.1);

    fireworks.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: randomBetween(1.6, 3.8),
      life: randomBetween(26, 46),
      maxLife: 46,
      color: fireworkColors[Math.floor(Math.random() * fireworkColors.length)]
    });
  }

  if (!fxRunning) {
    fxRunning = true;
    window.requestAnimationFrame(renderFireworks);
  }
}

function renderFireworks() {
  fxCtx.clearRect(0, 0, fxCanvas.clientWidth, fxCanvas.clientHeight);

  for (let i = fireworks.length - 1; i >= 0; i -= 1) {
    const p = fireworks[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vx *= 0.985;
    p.vy = p.vy * 0.985 + 0.045;
    p.life -= 1;

    if (p.life <= 0) {
      fireworks.splice(i, 1);
      continue;
    }

    const alpha = clamp(p.life / p.maxLife, 0, 1);
    fxCtx.globalAlpha = alpha;
    fxCtx.fillStyle = p.color;
    drawStar(fxCtx, p.x, p.y, p.size, p.size * 0.45, 5);
    fxCtx.fill();
  }

  fxCtx.globalAlpha = 1;

  if (fireworks.length > 0) {
    window.requestAnimationFrame(renderFireworks);
  } else {
    fxRunning = false;
  }
}

function getScrollProgress() {
  const scrollRange = document.documentElement.scrollHeight - lockedViewportHeight;
  if (scrollRange <= 0) return 0;
  return clamp(window.scrollY / scrollRange, 0, 1);
}

function drawCover(image) {
  if (!image || !image.complete || image.naturalWidth === 0) return;

  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const scale = Math.max(cw / iw, ch / ih);

  const drawWidth = iw * scale;
  const drawHeight = ih * scale;
  const dx = (cw - drawWidth) * 0.5;
  const dy = (ch - drawHeight) * 0.5;

  ctx.drawImage(image, dx, dy, drawWidth, drawHeight);
}

function getNearestLoadedFrame(target) {
  if (frameStore[target]) return target;

  for (let offset = 1; offset < TOTAL_FRAMES; offset += 1) {
    const left = target - offset;
    const right = target + offset;

    if (left >= 0 && frameStore[left]) return left;
    if (right < TOTAL_FRAMES && frameStore[right]) return right;
  }

  return -1;
}

function render() {
  const vh = lockedViewportHeight;
  const scrollY = window.scrollY;
  const scrollProgress = getScrollProgress();
  const target = Math.round(scrollProgress * (TOTAL_FRAMES - 1));
  currentFrame = target;

  const frameIndex = getNearestLoadedFrame(target);
  if (frameIndex >= 0) {
    drawCover(frameStore[frameIndex]);
  }

  const heroPanel = panels[0];
  if (heroPanel && heroTitle) {
    const rect = heroPanel.getBoundingClientRect();
    const heroProgress = clamp(-rect.top / vh, 0, 1.2);
    const alpha = clamp(1 - heroProgress * 0.85, 0.2, 1);
    const rise = clamp(heroProgress * 26, 0, 28);

    setStyleVar(heroPanel, "--hero-alpha", alpha.toFixed(3));
    setStyleVar(heroPanel, "--hero-rise", `${rise.toFixed(1)}px`);
  }

  let activeDetailIndex = -1;
  for (let i = 0; i < detailPanels.length; i += 1) {
    const start = detailStarts[i] ?? detailPanels[i].offsetTop;
    const nextStart = i < detailPanels.length - 1 ? (detailStarts[i + 1] ?? detailPanels[i + 1].offsetTop) : Number.POSITIVE_INFINITY;
    if (scrollY >= start && scrollY < nextStart) {
      activeDetailIndex = i;
      break;
    }
  }

  if (activeDetailIndex < 0 && detailPanels.length > 0) {
    const firstStart = detailStarts[0] ?? detailPanels[0].offsetTop;
    activeDetailIndex = scrollY < firstStart ? 0 : detailPanels.length - 1;
  }

  const firstDetailStart = detailStarts[0] ?? detailPanels[0]?.offsetTop ?? Number.POSITIVE_INFINITY;

  if (detailFooter) {
    const isVisible = scrollY >= firstDetailStart ? 1 : 0;
    setStyleVar(detailFooter, "--footer-alpha", isVisible.toFixed(3));
  }

  if (bgOverlay) {
    let overlayAlpha = 0.2;
    const transitionStart = Math.max(0, firstDetailStart - vh * 0.95);

    if (scrollY < firstDetailStart) {
      const transitionProgress = clamp((scrollY - transitionStart) / Math.max(firstDetailStart - transitionStart, 1), 0, 1);
      overlayAlpha = 0.2 + transitionProgress * 0.3;
    } else {
      overlayAlpha = 0.5;
    }

    overlayAlpha = clamp(overlayAlpha, 0.2, 0.5).toFixed(3);
    setStyleVar(bgOverlay, "--overlay-alpha", overlayAlpha);
  }

  for (let i = 0; i < detailPanels.length; i += 1) {
    const panel = detailPanels[i];
    const rect = panel.getBoundingClientRect();

    const begin = vh * 0.95;
    const settle = vh * 0.12;
    const progress = clamp((begin - rect.top) / (begin - settle), 0, 1);

    const titleY = (1 - progress) * vh * 0.24;
    const titleScale = 1 - progress * 0.58;
    const isActive = i === activeDetailIndex;
    const titleAlpha = isActive ? 0.6 + progress * 0.4 : 0.08;
    const bodyAlpha = isActive ? 1 : 0;
    const mediaAlpha = isActive ? progress : 0;
    const mediaScale = 0.9 + progress * 0.1;
    const panelZ = isActive ? 7 : 2;

    setStyleVar(panel, "--title-y", `${titleY.toFixed(1)}px`);
    setStyleVar(panel, "--title-scale", titleScale.toFixed(3));
    setStyleVar(panel, "--title-alpha", titleAlpha.toFixed(3));
    setStyleVar(panel, "--body-alpha", bodyAlpha.toFixed(3));
    setStyleVar(panel, "--media-alpha", mediaAlpha.toFixed(3));
    setStyleVar(panel, "--media-scale", mediaScale.toFixed(3));
    setStyleVar(panel, "--panel-z", String(panelZ));
  }

  ticking = false;
}

function requestRender() {
  if (ticking) return;
  ticking = true;
  window.requestAnimationFrame(render);
}

function getNearestAnchorIndex(scrollY) {
  if (panelAnchors.length === 0) return -1;

  let nearest = 0;
  let nearestDistance = Math.abs(scrollY - panelAnchors[0]);

  for (let i = 1; i < panelAnchors.length; i += 1) {
    const distance = Math.abs(scrollY - panelAnchors[i]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = i;
    }
  }

  return nearest;
}

function getSectionIndex(scrollY) {
  if (panelAnchors.length <= 1) return 0;

  for (let i = 0; i < panelAnchors.length - 1; i += 1) {
    const midpoint = (panelAnchors[i] + panelAnchors[i + 1]) * 0.5;
    if (scrollY < midpoint) return i;
  }

  return panelAnchors.length - 1;
}

function getSectionProgress(scrollY, index) {
  const start = panelAnchors[index] ?? 0;
  const end = index < panelAnchors.length - 1 ? panelAnchors[index + 1] : start + lockedViewportHeight;
  return clamp((scrollY - start) / Math.max(end - start, 1), 0, 1);
}

function pickSnapTarget(scrollY) {
  const nearestIndex = getNearestAnchorIndex(scrollY);
  if (nearestIndex < 0) return -1;

  const currentIndex = getSectionIndex(scrollY);
  const currentProgress = getSectionProgress(scrollY, currentIndex);
  const direction = scrollVelocity !== 0 ? Math.sign(scrollVelocity) : Math.sign(scrollIntent);
  const hasMomentum = Math.abs(scrollVelocity) >= SNAP_VELOCITY_THRESHOLD;

  if (direction > 0 && currentIndex < panelAnchors.length - 1) {
    if (currentProgress > SNAP_PROGRESS_BIAS || hasMomentum) {
      return currentIndex + 1;
    }
  }

  if (direction < 0 && currentIndex > 0) {
    if (currentProgress < 1 - SNAP_PROGRESS_BIAS || hasMomentum) {
      return currentIndex - 1;
    }
  }

  return nearestIndex;
}

function applyMagneticSnap() {
  if (snapLock || panelAnchors.length < 2) return;

  const scrollY = window.scrollY;
  const targetIndex = pickSnapTarget(scrollY);
  if (targetIndex < 0) return;

  const targetY = panelAnchors[targetIndex];
  const distance = Math.abs(targetY - scrollY);
  const animationMs = getSnapDuration(distance);
  const now = performance.now();

  if (distance < 1) return;
  if (targetIndex === lastSnapTarget && now - lastSnapAt < lastSnapDuration + SNAP_LOCK_BUFFER_MS) return;

  snapLock = true;
  lastSnapTarget = targetIndex;
  lastSnapAt = now;
  lastSnapDuration = animationMs;

  animateMagneticScroll(targetY, animationMs);

  window.setTimeout(() => {
    snapLock = false;
  }, animationMs + SNAP_LOCK_BUFFER_MS);
}

function getSnapDuration(distancePx) {
  const viewportHeight = Math.max(lockedViewportHeight, 1);
  const basedOnDistance = (distancePx / viewportHeight) * SNAP_MS_PER_VIEWPORT;
  return clamp(
    Math.round(Math.max(SNAP_MIN_ANIMATION_MS, basedOnDistance)),
    SNAP_MIN_ANIMATION_MS,
    SNAP_MAX_ANIMATION_MS
  );
}

function setCssSnapEnabled(enabled) {
  const value = enabled ? "" : "none";
  document.documentElement.style.scrollSnapType = value;
  document.body.style.scrollSnapType = value;
}

function animateMagneticScroll(targetY, durationMs) {
  const startY = window.scrollY;
  const distance = targetY - startY;
  if (Math.abs(distance) < 1) return;

  if (snapAnimationFrame) {
    window.cancelAnimationFrame(snapAnimationFrame);
  }

  const startTime = performance.now();
  snapAnimating = true;
  setCssSnapEnabled(false);

  function easeInOutCubic(t) {
    return t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function step(now) {
    const elapsed = now - startTime;
    const progress = clamp(elapsed / Math.max(durationMs, 1), 0, 1);
    const eased = easeInOutCubic(progress);
    const nextY = startY + distance * eased;

    window.scrollTo(0, nextY);

    if (progress < 1) {
      snapAnimationFrame = window.requestAnimationFrame(step);
      return;
    }

    window.scrollTo(0, targetY);
    setCssSnapEnabled(true);
    snapAnimating = false;
    snapAnimationFrame = 0;
  }

  snapAnimationFrame = window.requestAnimationFrame(step);
}

function scheduleMagneticSnap() {
  window.clearTimeout(stopTimer);
  stopTimer = window.setTimeout(() => {
    applyMagneticSnap();
  }, SNAP_STOP_DEBOUNCE_MS);
}

function handleScroll() {
  const now = performance.now();
  const scrollY = window.scrollY;
  const delta = scrollY - lastScrollY;
  const deltaTime = Math.max(now - lastScrollTime, 1);

  scrollVelocity = delta / deltaTime;
  if (delta !== 0) {
    scrollIntent = delta;
  }

  lastScrollY = scrollY;
  lastScrollTime = now;

  requestRender();

  if (!snapLock && !snapAnimating) {
    scheduleMagneticSnap();
  }
}

function loadFrame(index) {
  if (frameStore[index]) return;

  const img = new Image();
  img.decoding = "async";
  img.src = FRAME_PATH(index + 1);

  img.onload = () => {
    const finalize = () => {
      frameStore[index] = img;
      if (Math.abs(index - currentFrame) <= 2) requestRender();
    };

    if (typeof img.decode === "function") {
      img.decode().catch(() => {}).finally(finalize);
      return;
    }

    finalize();
  };
}

function preloadStaticImages() {
  if (staticImageSources.length === 0) return;

  const start = () => {
    for (const src of staticImageSources) {
      const img = new Image();
      img.decoding = "async";
      img.src = src;
      if (typeof img.decode === "function") {
        img.decode().catch(() => {});
      }
    }
  };

  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(start, { timeout: 1200 });
    return;
  }

  window.setTimeout(start, 80);
}

function preloadFrames() {
  loadFrame(0);
  requestRender();

  let i = 1;
  function batchLoad() {
    const end = Math.min(i + 10, TOTAL_FRAMES);
    for (; i < end; i += 1) loadFrame(i);

    if (i < TOTAL_FRAMES) {
      window.setTimeout(batchLoad, 40);
    }
  }

  batchLoad();
}

function resizeCanvas() {
  updateRatioScale();
  const ratio = window.devicePixelRatio || 1;
  const width = Math.round(lockedViewportWidth * ratio);
  const height = Math.round(lockedViewportHeight * ratio);

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  if (fxCanvas.width !== width || fxCanvas.height !== height) {
    fxCanvas.width = width;
    fxCanvas.height = height;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  fxCtx.setTransform(ratio, 0, 0, ratio, 0, 0);
  requestRender();
}

window.addEventListener("scroll", handleScroll, { passive: true });
if ("onscrollend" in window) {
  window.addEventListener("scrollend", () => {
    applyMagneticSnap();
  });
}
window.addEventListener("pointerdown", (event) => {
  spawnFirework(event.clientX, event.clientY);
});
window.addEventListener("pageshow", () => {
  const orientation = getOrientation();
  if (orientation !== lockedOrientation) {
    lockViewportSize();
    resizeCanvas();
  }

  window.scrollTo(0, 0);
  refreshPanelAnchors();
  refreshDetailStarts();
  requestRender();
});
window.addEventListener("resize", () => {
  const orientation = getOrientation();
  if (orientation !== lockedOrientation) {
    lockViewportSize();
    resizeCanvas();
    refreshPanelAnchors();
    refreshDetailStarts();
    requestRender();
  }
});

lockViewportSize();
resizeCanvas();
refreshPanelAnchors();
refreshDetailStarts();
preloadStaticImages();
preloadFrames();
