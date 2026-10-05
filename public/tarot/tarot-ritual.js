/**
 * 🔮 오늘의 타로 — 카드를 고른 뒤 열리기까지 「문양 의식」 (REQ-48 · Master 확정 2026-10-05)
 *
 * 원본 시안: `오늘의나/tarot/design/뽑기대기_모션시안_A변형.html` 의 「A-2+ 신비로운 문양」.
 * 동작·타이밍·색은 시안을 그대로 옮겼다(시안의 앞면 색 상자 대신 실제 카드 그림).
 *
 * ── 왜 이 몇 초인가 ──────────────────────────────────────────────────────
 * 고른 뒤 서버 응답 + 그림 받기(3G 에서 3~4초) 동안 카드가 올라온 채 멈춘 듯 보였다.
 * 이 시간을 「어떤 카드일까」 기대하는 의식으로 바꾼다. 그래서 응답이 빨라도 **고른 순간부터
 * 4초** 는 의식을 하고, 늦으면 받는 즉시(색이 물든 것을 0.9초는 본 뒤) 연다.
 *
 * ── 장면 ────────────────────────────────────────────────────────────────
 *   1. 고른 카드가 가운데로 떠오르며 커짐(1.45배) · 나머지 부채는 흐려지며 사라짐 · 공중에서 기울며 흔들림 · 안개빛
 *   2. 화면 가장자리에서 빛 알갱이가 카드 중심으로 빨려 들어감(캔버스) · 금빛 고리가 테두리를 돎
 *   3. 뒷면 가운데에 문양이 빛나는 펜 끝으로 그려짐 — 바깥(이중 고리 → 지어낸 룬 12)과
 *      안쪽(작은 원 → 팔각 별 + 꼭짓점 별 8 → 초승달 → 눈 → 작은 별)이 두 갈래로 동시에, 약 2초
 *   4. 완성 뒤: 두 고리 반대 방향 회전 · 빛살 12 맥박 · 중심 숨쉬기
 *   5. 응답 도착 → 문양·알갱이·고리·안개가 그 카드 계열 색으로 물듦
 *   6. 열림: 그 색의 섬광 + 카드가 튕기듯 뒤집힘 → 결과 흐름
 *
 * 문양은 종교 상징으로 읽히는 모양(육각별 등)을 쓰지 않고, 룬은 실제 문자가 아니다 — 시안 그대로.
 *
 * ── 시간 기준으로 진행한다 ──────────────────────────────────────────────
 * 탭이 백그라운드면 rAF 가 멈춘다. 펜 끝 그리기는 「시작부터 지난 시간」으로 진행도를 정하므로
 * 돌아오면 멈춘 자리가 아니라 지금 있어야 할 자리로 간다. 열리는 시각도 setTimeout 기준이다.
 *
 * ── 정리 ────────────────────────────────────────────────────────────────
 * `cancel()` 이 rAF·타이머·캔버스·덧붙인 요소를 전부 걷는다. 오류로 부채에 머물 때와 결과로
 * 넘어갈 때 모두 부른다. 빛 알갱이는 동시에 120개를 넘지 않는다(저사양).
 */

/** 카드 계열 색 — 메이저 보라 · 완드 주황 · 컵 파랑 · 소드 은빛 · 펜타클 초록 */
const SUIT_COLORS = ["#c79bff", "#ff9a4a", "#5fb8ff", "#cfe3ff", "#8fdc8a"];
export const suitColor = (cardId) => SUIT_COLORS[cardId < 22 ? 0 : 1 + Math.floor((cardId - 22) / 14)];

/** 의식 길이 — 고른 순간부터 이만큼은 연다(Master 결정 · 움직임 줄이기면 1.5초) */
const RITUAL_MS = 4000;
const RITUAL_REDUCED_MS = 1500;
/** 응답이 늦었을 때도 물든 색을 이만큼은 보여 준 뒤 연다 */
const COLOR_MIN_MS = 900;
/** 열림(섬광 + 뒤집힘) 연출 길이 — 시안 reveal 의 0.9초 전이 + 잠깐 머묾 */
const REVEAL_MS = 1200;
/** 빛 알갱이 동시 상한 */
const MAX_PARTS = 120;

const NS = "http://www.w3.org/2000/svg";

/**
 * @param {{ stage: HTMLElement, node: HTMLElement, hint: HTMLElement, reduced: boolean }} o
 *   stage 부채 무대 · node 고른 부채 카드 · hint 안내 문구 자리
 */
export function startRitual({ stage, node, hint, reduced }) {
  const t0 = performance.now();
  let alive = true;
  let raf = 0;
  let parts = [];
  let answeredAt = null;
  const timers = [];
  const later = (ms, f) => {
    const t = setTimeout(() => alive && f(), ms);
    timers.push(t);
    return t;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

  // ── 무대 ──
  stage.classList.add("is-ritual"); // 나머지 부채가 흐려지며 사라진다(tarot.css)
  const root = div("ritual");
  const canvas = document.createElement("canvas");
  canvas.className = "ritual__fx";
  const card = div("ritual__card");
  const back = div("ritual__back");
  const front = div("ritual__front");
  const ring = div("ritual__ring");
  const mist = div("ritual__mist");
  const flash = div("ritual__flash");
  card.append(mist, back, ring, front);
  root.append(canvas, card, flash);
  stage.append(root);

  // 고른 카드 자리에서 시작해 가운데로 떠오른다
  const sr = stage.getBoundingClientRect();
  const nr = node.getBoundingClientRect();
  card.style.transition = "none";
  card.style.left = `${nr.left - sr.left + nr.width / 2}px`;
  card.style.top = `${nr.top - sr.top + nr.height / 2}px`;
  card.style.transform = `translate(-50%, -50%) scale(${(nr.width / 96).toFixed(3)})`;
  void card.offsetWidth;
  card.style.transition = "";
  card.style.left = "50%";
  card.style.top = "50%";
  card.style.transform = "translate(-50%, -50%) scale(1.45)";

  // ── 문구 ── 「알아보는 중」 → 1.6초 「기운이 모이고」 → (응답) 「모습을 드러내요」
  const say = (t) => {
    hint.style.opacity = "0";
    later(250, () => {
      hint.textContent = t;
      hint.style.opacity = "1";
    });
  };
  say("카드가 당신을 알아보는 중이에요");
  // 움직임 줄이기는 의식이 1.5초라 둘째 문구를 건너뛴다
  if (!reduced) {
    later(1600, () => {
      if (answeredAt == null) say("오늘의 기운이 모이고 있어요");
    });
  }

  const svg = buildSigil(card);

  if (reduced) {
    // 움직임 줄이기 — 알갱이·회전·흔들림·펜 끝 없이 완성된 문양을 정지 상태로
    for (const p of svg.querySelectorAll("path")) p.style.strokeDashoffset = "0";
    for (const n of svg.querySelectorAll(".node")) n.style.opacity = "1";
    svg.classList.add("is-static");
    ring.classList.add("on", "is-static");
    mist.classList.add("on", "is-static");
  } else {
    later(300, () => ring.classList.add("on"));
    later(400, () => mist.classList.add("on"));
    later(500, () => card.classList.add("tilt"));
    later(350, () => drawSigil(svg, () => alive).then(() => alive && svg.classList.add("done")));
    runParticles();
  }

  function runParticles() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = root.clientWidth * dpr;
    canvas.height = root.clientHeight * dpr;
    const ctx = canvas.getContext("2d");
    const W = canvas.width;
    const H = canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const spawn = () => {
      const a = Math.random() * Math.PI * 2;
      const R = Math.max(W, H) * 0.6;
      parts.push({ x: cx + Math.cos(a) * R, y: cy + Math.sin(a) * R, s: (1 + Math.random() * 2) * dpr, v: 0.012 + Math.random() * 0.02 });
    };
    const loop = () => {
      if (!alive) return;
      ctx.clearRect(0, 0, W, H);
      for (let i = 0; i < 4 && parts.length < MAX_PARTS; i++) spawn();
      const col = getComputedStyle(root).getPropertyValue("--c").trim() || "#f3e3b0";
      parts = parts.filter((p) => {
        p.x += (cx - p.x) * p.v * 2.2;
        p.y += (cy - p.y) * p.v * 2.2;
        const d = Math.hypot(cx - p.x, cy - p.y);
        ctx.globalAlpha = Math.min(1, d / (80 * dpr));
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.s, 0, 7);
        ctx.fill();
        return d > 8 * dpr;
      });
      raf = requestAnimationFrame(loop);
    };
    loop();
  }

  const ritualMs = reduced ? RITUAL_REDUCED_MS : RITUAL_MS;

  return {
    /**
     * 카드가 정해졌다 — 그 계열 색으로 물든다.
     *
     * 응답이 빠르면(로컬·좋은 회선은 0.1초도 안 걸린다) 받자마자 물들이지 않고 **열리기 0.9초
     * 전**까지 기다렸다 물들인다. 받는 즉시 물들이면 「알아보는 중 → 기운이 모이고」가 통째로
     * 건너뛰어지고 4초 내내 「모습을 드러내요」만 남는다(개발 측정). 늦게 오면 받는 즉시 물든다.
     */
    answer(cardId) {
      if (!alive) return;
      const show = () => {
        answeredAt = performance.now();
        root.style.setProperty("--c", suitColor(cardId));
        say("오늘의 카드가 모습을 드러내요");
      };
      const wait = t0 + ritualMs - COLOR_MIN_MS - performance.now();
      if (wait > 0) later(wait, show);
      else show();
    },

    /**
     * 열 때가 되면 연다 — 고른 뒤 4초(움직임 줄이기 1.5초)와 물든 뒤 0.9초 중 늦은 쪽.
     * @param {Node} face 카드 앞면(실제 그림)
     */
    async reveal(face) {
      // 물들기가 예약돼 있으면 그때를 기다린다
      while (alive && answeredAt == null) await sleep(50);
      const now = performance.now();
      const at = Math.max(t0 + ritualMs, answeredAt + COLOR_MIN_MS);
      await sleep(at - now);
      if (!alive) return;
      cancelAnimationFrame(raf);
      canvas.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
      front.append(face);
      flash.classList.remove("go");
      void flash.offsetWidth;
      flash.classList.add("go");
      card.classList.remove("tilt");
      for (const e of card.querySelectorAll(".ritual__ring, .ritual__mist, svg")) e.remove();
      card.classList.add(reduced ? "is-revealed-still" : "is-revealed");
      navigator.vibrate?.([12, 60, 22]);
      await sleep(REVEAL_MS);
    },

    /** 전부 걷는다 — rAF·타이머·캔버스·덧붙인 요소·무대 상태 */
    cancel() {
      alive = false;
      cancelAnimationFrame(raf);
      for (const t of timers) clearTimeout(t);
      parts = [];
      root.remove();
      stage.classList.remove("is-ritual");
      hint.style.opacity = "";
    },
  };
}

function div(cls) {
  const d = document.createElement("div");
  d.className = cls;
  return d;
}

/**
 * 문양 SVG — 시안 `mystic()` 의 획 목록 그대로. 획은 감춰진 채(dashoffset = 길이) 만들고,
 * drawSigil 이 펜 끝으로 그린다.
 */
function buildSigil(card) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "myst");
  svg.setAttribute("viewBox", "-43 -43 86 86");
  svg.setAttribute("aria-hidden", "true");
  card.append(svg);
  const el = (t, a, p = svg) => {
    const e = document.createElementNS(NS, t);
    for (const k in a) e.setAttribute(k, a[k]);
    p.appendChild(e);
    return e;
  };

  const rays = el("g", { class: "rays" });
  for (let i = 0; i < 12; i++) {
    const a = (i * Math.PI) / 6;
    el("line", { x1: Math.cos(a) * 36, y1: Math.sin(a) * 36, x2: Math.cos(a) * 42, y2: Math.sin(a) * 42, style: `animation-delay:${(i % 4) * 0.2}s` }, rays);
  }
  const gA = el("g", { class: "rotA" });
  const gB = el("g", { class: "rotB" });
  const gC = el("g", { class: "core" });

  const R = (r) => `M 0 ${-r} A ${r} ${r} 0 1 1 -0.01 ${-r}`;
  const strokes = [];
  strokes.push([gA, R(33), 1.1], [gA, R(29.5), 0.6]);
  // 고리 사이의 지어낸 룬 12개 — 실제 문자가 아니다
  const shapes = ["M -1.6 -1.2 L 0 1.4 L 1.6 -1.2", "M -1.4 -1.4 L 1.4 1.4 M -1.4 1.4 L 0 0", "M 0 -1.6 L 0 1.6 M -1.3 -0.4 L 1.3 -0.4", "M -1.5 1.2 L 0 -1.4 L 1.5 1.2 Z"];
  for (let i = 0; i < 12; i++) {
    const a = (i * 30 * Math.PI) / 180;
    strokes.push([gA, shapes[i % 4], 0.5, `translate(${(Math.cos(a) * 31.3).toFixed(2)} ${(Math.sin(a) * 31.3).toFixed(2)}) rotate(${i * 30 + 90})`]);
  }
  strokes.push([gB, R(22), 0.6]);
  // 팔각 별(8점을 세 칸씩 건너 이음) — 종교 상징으로 읽히는 육각별은 피한다
  {
    let d = "";
    for (let i = 0; i <= 8; i++) {
      const a = ((((i * 3) % 8) * 45 - 90) * Math.PI) / 180;
      d += `${i ? "L " : "M "}${(Math.cos(a) * 22).toFixed(2)} ${(Math.sin(a) * 22).toFixed(2)} `;
    }
    strokes.push([gB, d, 0.7]);
  }
  strokes.push([gB, R(9.5), 0.5]);
  // 가운데: 초승달 + 눈 + 별
  strokes.push([gC, "M 6 -11 A 12 12 0 1 0 6 11 A 9.5 9.5 0 1 1 6 -11", 0.9]);
  strokes.push([gC, "M -7 0 Q 0 -6 7 0 Q 0 6 -7 0", 0.7]);
  strokes.push([gC, "M 0 -3 L 0.9 -0.9 L 3 0 L 0.9 0.9 L 0 3 L -0.9 0.9 L -3 0 L -0.9 -0.9 Z", 0.6]);
  // 꼭짓점 별(노드)
  for (let i = 0; i < 8; i++) {
    const a = ((i * 45 - 90) * Math.PI) / 180;
    el("circle", { class: "node", cx: Math.cos(a) * 22, cy: Math.sin(a) * 22, r: 1.4 }, gB);
  }
  for (const [g, d, w, tf] of strokes) {
    const p = el("path", { d, class: "ln glow", "stroke-width": w, transform: tf || "" }, g);
    const L = p.getTotalLength();
    p.style.strokeDasharray = L;
    p.style.strokeDashoffset = L;
    p.dataset.len = L;
  }
  el("circle", { class: "pen penA", r: 1.8, opacity: 0 });
  el("circle", { class: "pen penB", r: 1.5, opacity: 0 });
  return svg;
}

/**
 * 두 갈래로 동시에 그린다 — 바깥(고리·룬)과 안쪽(별·달·눈). 약 2초에 완성.
 * 진행도는 **지난 시간**으로 정한다(탭이 숨었다 돌아와도 제자리로 따라온다).
 */
function drawSigil(svg, isAlive) {
  const paths = [...svg.querySelectorAll("path")];
  const outer = paths.slice(0, 14);
  const inner = paths.slice(14);
  const nodes = [...svg.querySelectorAll(".node")];
  const penA = svg.querySelector(".penA");
  const penB = svg.querySelector(".penB");
  const dur = [380, 260, ...Array(12).fill(200)];
  const durIn = [220, 480, 160, 320, 220, 170];
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  const drawOne = (p, ms, pen) =>
    new Promise((res) => {
      const L = Number(p.dataset.len);
      const t0 = performance.now();
      const small = L < 12;
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        p.style.strokeDashoffset = L * (1 - k);
        if (pen && !small) {
          const pt = p.getPointAtLength(L * k);
          const q = svg.createSVGPoint();
          q.x = pt.x;
          q.y = pt.y;
          const r = q.matrixTransform(p.getCTM()).matrixTransform(svg.getCTM().inverse());
          pen.setAttribute("cx", r.x);
          pen.setAttribute("cy", r.y);
          pen.setAttribute("opacity", 1);
        }
        if (k < 1 && isAlive()) requestAnimationFrame(step);
        else res();
      };
      requestAnimationFrame(step);
      // rAF 가 멈춘(백그라운드) 동안에도 끝은 나야 한다 — 시간이 다 되면 마저 그린다
      setTimeout(() => {
        p.style.strokeDashoffset = 0;
        res();
      }, ms + 50);
    });

  const trackOuter = async () => {
    await drawOne(outer[0], dur[0], penA);
    await drawOne(outer[1], dur[1], penA);
    penA.setAttribute("opacity", 0);
    await Promise.all(outer.slice(2).map((p, i) => wait(i * 28).then(() => drawOne(p, dur[2 + i]))));
  };
  const trackInner = async () => {
    await wait(300);
    for (let i = 0; i < inner.length; i++) {
      if (!isAlive()) return;
      await drawOne(inner[i], durIn[i], penB);
      if (i === 2) nodes.forEach((n, j) => setTimeout(() => (n.style.opacity = 1), j * 50));
      await wait(30);
    }
    penB.setAttribute("opacity", 0);
  };
  return Promise.all([trackOuter(), trackInner()]);
}
