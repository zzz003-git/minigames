/**
 * 🧪 테스트 빌드 띠 — 스테이징에서만 뜬다
 *
 * ── 왜 여기에 초기화 버튼이 있나 ─────────────────────────────────────────
 * 게임은 「하루 n판」이라 `TEST_MODE` 로 한도가 풀린다. 그런데 오늘의 나 3종은
 * 한도가 아니라 **하루 1회로 완결되는 구조**라 한 번 하고 나면 내일까지 못 본다.
 * 테스터가 폰에서 직접 되감을 수 있어야 재테스트가 된다.
 *
 * 서버(`/api/test/reset`)는 `TEST_MODE` 가 아니면 **404 로 응답한다.** 그래서 이
 * 버튼이 실수로 프로덕션 화면에 그려져도 아무 일도 일어나지 않는다 — 다만 띠 자체가
 * `test_mode` 일 때만 뜨므로 그럴 일도 없다.
 */

const RESETS = [
  {
    scope: "day",
    label: "오늘 다시",
    desc: "오늘의 나 3종을 오늘 아직 안 한 상태로 되돌립니다",
  },
  {
    scope: "all",
    label: "처음부터",
    desc: "도감·포인트·사주 생년월일까지 지우고 갓 가입한 상태로 되돌립니다",
  },
];

export async function renderTestBanner(host) {
  if (!host) return;

  let config;
  try {
    const r = await fetch("/game/config");
    config = await r.json();
  } catch {
    return;
  }
  // 성공 봉투는 `{ ...데이터, ok: true }` 로 **평평하다**(src/lib/http.js).
  // `r.data.test_mode` 로 한 겹 더 타면 언제나 undefined 라 띠가 안 뜬다.
  if (!config?.test_mode) return;

  host.className = "testbar";
  host.hidden = false;
  host.textContent = "";

  const line = document.createElement("span");
  line.className = "testbar__text";
  line.textContent = "테스트 빌드 — 하루 한도가 풀려 있습니다. 기록은 실서비스와 분리됩니다.";
  host.append(line);

  const note = document.createElement("span");
  note.className = "testbar__note";
  host.append(note);

  for (const r of RESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "testbar__btn";
    btn.textContent = r.label;
    btn.title = r.desc;

    btn.addEventListener("click", async () => {
      // 「처음부터」는 도감까지 지운다. 한 번 물어본다 — 되돌릴 수 없다.
      if (r.scope === "all" && !confirm(`${r.desc}\n\n되돌릴 수 없습니다. 진행할까요?`)) return;

      for (const b of host.querySelectorAll("button")) b.disabled = true;
      note.textContent = "되감는 중…";

      try {
        const res = await fetch("/api/test/reset", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: r.scope }),
        });
        if (!res.ok) throw new Error(String(res.status));
        note.textContent = "되돌렸어요 · 새로고침합니다";
        location.reload();
      } catch {
        note.textContent = "되감지 못했어요";
        for (const b of host.querySelectorAll("button")) b.disabled = false;
      }
    });

    host.append(btn);
  }
}
