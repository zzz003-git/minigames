/** 공통 UI 헬퍼 — DOM 생성, 화면 전환, 헤더, 숫자패드, 토스트, 서식 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** el('div', { class: 'card' }, '내용') */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const clear = (node) => {
  while (node.firstChild) node.removeChild(node.firstChild);
  return node;
};

const reduceMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

// ── 화면 전환 ─────────────────────────────────────────────────

export function showScreen(name) {
  for (const s of $$("[data-screen]")) {
    s.classList.toggle("is-active", s.dataset.screen === name);
  }
  window.scrollTo({ top: 0, behavior: reduceMotion() ? "auto" : "smooth" });
}

export const currentScreen = () => $(".screen.is-active")?.dataset.screen ?? null;

// ── 헤더 (반투명 라운드 바) ────────────────────────────────────

/**
 * @param {HTMLElement} host  <header class="topbar" id="header">
 * @param {{ icon?:string, title:string, sub?:string, badge?:string }} opts
 */
export function renderHeader(host, { icon, title, sub, badge } = {}) {
  clear(host);
  host.classList.add("topbar");

  host.append(
    el("a", { class: "topbar__back", href: "/", "aria-label": "게임 목록으로 돌아가기" }, "←"),
    icon ? el("span", { class: "topbar__icon", "aria-hidden": "true" }, icon) : null,
    el(
      "span",
      { class: "topbar__text" },
      el("span", { class: "topbar__title" }, title),
      sub ? el("span", { class: "topbar__sub" }, sub) : null,
    ),
    badge ? el("span", { class: "topbar__badge", id: "headerBadge" }, badge) : null,
  );
}

/** 헤더 우측 배지 문구만 갱신 */
export function setHeaderBadge(text) {
  const badge = $("#headerBadge");
  if (badge) badge.textContent = text;
}

// ── 토스트 ───────────────────────────────────────────────────

function toastHost() {
  let host = $(".toast-host");
  if (!host) {
    host = el("div", { class: "toast-host", role: "status", "aria-live": "polite" });
    document.body.append(host);
  }
  return host;
}

const TOAST_ICON = { error: "⚠", good: "✓", "": "•" };

export function toast(message, kind = "", ms = 2600) {
  const node = el(
    "div",
    { class: `toast ${kind ? `toast--${kind}` : ""}` },
    el("span", { class: "toast__icon", "aria-hidden": "true" }, TOAST_ICON[kind] ?? "•"),
    el("span", {}, message),
  );
  toastHost().append(node);
  setTimeout(() => node.remove(), ms);
}

// ── 숫자패드 ─────────────────────────────────────────────────

/**
 * @param {HTMLElement} host
 * @param {{ onDigit:(d:string)=>void, onBack:()=>void, onOk:()=>void, okLabel?:string }} handlers
 * @returns {{ setOkEnabled:(v:boolean)=>void }}
 */
export function mountNumpad(host, { onDigit, onBack, onOk, okLabel = "OK" }) {
  clear(host);
  host.classList.add("numpad");

  for (const d of ["1", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    host.append(
      el("button", { class: "numpad__key", type: "button", onclick: () => onDigit(d) }, d),
    );
  }

  host.append(
    el(
      "button",
      { class: "numpad__key numpad__key--util", type: "button", onclick: onBack, "aria-label": "한 자리 지우기" },
      "⌫",
    ),
    el("button", { class: "numpad__key", type: "button", onclick: () => onDigit("0") }, "0"),
  );

  const okBtn = el(
    "button",
    { class: "numpad__key numpad__key--ok", type: "button", onclick: onOk, "aria-label": "확인" },
    okLabel,
  );
  host.append(okBtn);

  return { setOkEnabled: (v) => (okBtn.disabled = !v) };
}

/** 물리 키보드로도 숫자패드를 쓸 수 있게 연결합니다. */
export function bindKeyboardNumpad({ onDigit, onBack, onOk, isActive }) {
  const handler = (e) => {
    if (isActive && !isActive()) return;
    if (/^[0-9]$/.test(e.key)) { onDigit(e.key); e.preventDefault(); }
    else if (e.key === "Backspace") { onBack(); e.preventDefault(); }
    else if (e.key === "Enter") { onOk(); e.preventDefault(); }
  };
  window.addEventListener("keydown", handler);
  return () => window.removeEventListener("keydown", handler);
}

// ── 남은 기회 인디케이터 ──────────────────────────────────────

/**
 * 원형 pill 인디케이터. 기본 제공분과 광고로 받은 보너스분을 구분해서 표시합니다.
 * @param {{ total:number, used:number, base?:number }} opts
 */
export function renderPips(host, { total, used, base = total }) {
  clear(host);
  host.classList.add("pips");
  const remaining = Math.max(0, total - used);

  for (let i = 0; i < total; i++) {
    const filled = i < remaining;
    const bonus = i >= base;
    host.append(
      el("span", {
        class: `pip ${filled ? "is-filled" : ""} ${!filled && bonus ? "is-bonus" : ""}`,
        "aria-hidden": "true",
      }),
    );
  }

  // 스크린리더용 텍스트 (색·도형만으로 정보를 전달하지 않도록)
  host.append(el("span", { class: "sr-only" }, `남은 기회 ${remaining}회, 전체 ${total}회`));
}

// ── 숫자 슬롯 ────────────────────────────────────────────────

/**
 * @param {{ length:number, value:string, small?:boolean, blind?:boolean,
 *           marks?:boolean[], expected?:string }} opts
 *   marks 를 주면 채점 결과 표시 모드로 그립니다(색 + 아이콘 함께).
 */
export function renderSlots(host, { length, value = "", small = false, blind = false, marks = null, expected = "" }) {
  clear(host);
  host.classList.add("slots");

  for (let i = 0; i < length; i++) {
    const ch = value[i];
    const cls = ["slot"];
    if (small) cls.push("slot--sm");

    if (marks) {
      const ok = Boolean(marks[i]);
      cls.push(ok ? "is-correct" : "is-wrong");
      host.append(
        el(
          "div",
          { class: cls.join(" "), title: ok ? "정답" : `정답은 ${expected[i] ?? "?"}` },
          el("span", {}, ok ? (expected[i] ?? ch ?? "?") : (ch ?? "_")),
          el("span", { class: "slot__mark", "aria-hidden": "true" }, ok ? "✓" : "✕"),
        ),
      );
      continue;
    }

    if (blind) {
      cls.push("slot--blind");
      host.append(el("div", { class: cls.join(" ") }, "?"));
      continue;
    }

    if (ch != null) cls.push("is-filled");
    else if (i === value.length) cls.push("is-active");
    else cls.push("is-empty");

    host.append(el("div", { class: cls.join(" ") }, ch ?? "·"));
  }
}

// ── 차트 ─────────────────────────────────────────────────────

/**
 * 히스토그램. bins 는 [{from,to,count}], mine 은 내 값(해당 구간 강조).
 */
export function renderChart(host, { bins, mine = null, caption = "", short = false }) {
  clear(host);
  const chart = el("div", { class: `chart ${short ? "chart--short" : ""}` });

  if (!bins || bins.length === 0) {
    chart.append(el("div", { class: "chart__empty" }, "아직 데이터가 없습니다"));
  } else {
    const max = Math.max(...bins.map((b) => b.count), 1);
    for (const b of bins) {
      const isMine = mine != null && mine >= b.from && mine <= b.to;
      chart.append(
        el("div", {
          class: `chart__bar ${isMine ? "is-mine" : ""}`,
          style: `height:${Math.max(3, (b.count / max) * 100)}%`,
          title: `${b.count}명`,
        }),
      );
    }
  }

  host.append(chart);
  if (caption) host.append(el("div", { class: "chart__caption" }, caption));
}

// ── 통계 타일 ────────────────────────────────────────────────

/** items: [{ value, label, accent? }] */
export function renderStats(host, items) {
  clear(host);
  host.classList.add("stats");
  for (const t of items) {
    host.append(
      el(
        "div",
        { class: `stat ${t.accent ? "stat--accent" : ""}` },
        el("div", { class: "stat__value" }, t.value),
        el("div", { class: "stat__label" }, t.label),
      ),
    );
  }
}

// ── 성공 연출 (절제해서 사용) ──────────────────────────────────

const CONFETTI_COLORS = ["#69c7b3", "#f0957f", "#e7c878", "#a99ae8"];

/**
 * 성공 카드에 작은 confetti 를 한 번 뿌립니다.
 * prefers-reduced-motion 이면 아무것도 하지 않습니다.
 */
export function celebrate(host, { pieces = 14 } = {}) {
  if (!host || reduceMotion()) return;

  host.querySelector(".confetti")?.remove();
  const layer = el("div", { class: "confetti", "aria-hidden": "true" });

  for (let i = 0; i < pieces; i++) {
    layer.append(
      el("span", {
        class: "confetti__bit",
        style: [
          `left:${6 + (i * 88) / pieces + (i % 3) * 2}%`,
          `background:${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
          `animation-delay:${(i % 5) * 60}ms`,
        ].join(";"),
      }),
    );
  }

  host.append(layer);
  setTimeout(() => layer.remove(), 1800);
}

// ── 서식 ─────────────────────────────────────────────────────

/** 3470 → '3.470' (소수점 3자리, 기획서 오차 표기 규격) */
export const ms3 = (ms) => (ms / 1000).toFixed(3);

/** 3470 → '3.47' */
export const ms2 = (ms) => (ms / 1000).toFixed(2);

/** 부호를 붙인 오차 표기: 120 → '+0.120초' */
export const gapText = (ms) => `${ms >= 0 ? "+" : "−"}${(Math.abs(ms) / 1000).toFixed(3)}초`;

/** 74000 → '1:14' */
export function mmss(ms) {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export const comma = (n) => Number(n ?? 0).toLocaleString("ko-KR");
