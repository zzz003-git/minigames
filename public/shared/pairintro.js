/**
 * 「너를 맞혀볼게」 소개 시트 B — 첫 탭 1회 (REQ-63 · flow/mind.md C-7)
 *
 * 선택 결과의 `#pairCta` 와 허브 페어 띠가 같이 쓴다. 본 적이 있으면 링크 그대로 간다.
 * 「봤다」 기억은 이 기기 localStorage — 편의 기억이라 실패하면 시트가 한 번 더 뜰 뿐이다.
 * 스타일은 shared/nextbar.css 의 `.pairsheet`.
 */

import { el } from "./ui.js";

const KEY = "mg_pairintro_seen";

const seen = () => {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
};

export function bindPairIntro(link) {
  link?.addEventListener("click", (e) => {
    if (seen()) return;
    e.preventDefault();
    openSheet(link.href);
  });
}

function openSheet(href) {
  const close = () => sheet.remove();
  const sheet = el(
    "div",
    { class: "pairsheet", role: "dialog", "aria-modal": "true", "aria-label": "너를 맞혀볼게", onclick: (e) => e.target === sheet && close() },
    el(
      "div",
      { class: "pairsheet__box" },
      el("p", { class: "pairsheet__title" }, "너를 맞혀볼게"),
      el(
        "ol",
        { class: "pairsheet__list" },
        el("li", {}, "그 사람이라면 뭘 고를지 3문항을 내가 맞혀 봐요"),
        el("li", {}, "링크를 보내면 그 사람이 진짜 답을 골라요 (가입·설치 없음)"),
        el("li", {}, "서로 얼마나 아는지 %가 나와요"),
      ),
      el("p", { class: "pairsheet__note" }, "이름·연락처는 받지 않아요"),
      el(
        "div",
        { class: "pairsheet__btns" },
        el("button", {
          class: "pairsheet__go",
          type: "button",
          onclick: () => {
            try {
              localStorage.setItem(KEY, "1");
            } catch {
              /* 기억 못 해도 간다 */
            }
            location.href = href;
          },
        }, "시작하기"),
        el("button", { class: "pairsheet__later", type: "button", onclick: close }, "다음에"),
      ),
    ),
  );
  document.body.append(sheet);
}
