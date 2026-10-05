/**
 * 🔬 오늘의 선택 — 그날의 선택 고르기 (REQ-43)
 *
 * 화면(mind.js)과 시험(scripts/test-mind.mjs)이 같은 함수를 쓰려고 따로 뗐다. DOM 을 모른다.
 * 규칙의 원본은 기획의 `오늘의나/mind/tools/pick_sim.py` `pick()` 이다 — 둘이 어긋나면 그쪽이 맞다.
 *
 * ── 규칙 ────────────────────────────────────────────────────────────────
 *   pool = 그 요일의 선택
 *   seas = pool 중 `months` 에 이번 달이 든 것 (DB 순서)
 *   k    = 그달 몇 번째 같은 요일(0부터) = floor((일 − 1) / 7)
 *   k < seas.length → seas[k]                         계절 항목이 먼저
 *   아니면 → base = pool 중 months 없는 것, base[주차 % base.length]
 *
 * `months` 가 있는 항목은 그달이 아니면 **절대** 나오지 않는다. 주차는 1970-01-01 기준이고,
 * 같은 요일끼리만 세므로 회전이 고르게 돈다.
 *
 * 주 번호는 날짜에서 결정적으로 뽑는다. 무작위로 하면 새로고침마다 선택이 바뀌어
 * 「오늘의 선택」이라는 말이 거짓이 된다.
 */
export function expOfDay(experiments, dow, day) {
  const pool = experiments.filter((e) => e.dow === dow);
  if (!pool.length) return experiments[0];
  if (!day) return pool[0];

  const [, m, d] = day.split("-").map(Number);
  const seas = pool.filter((e) => e.months?.includes(m));
  const k = Math.floor((d - 1) / 7);
  if (k < seas.length) return seas[k];

  const base = pool.filter((e) => !e.months?.length);
  if (!base.length) return pool[0];
  const week = Math.floor(Date.parse(`${day}T00:00:00Z`) / (7 * 24 * 60 * 60 * 1000));
  return base[((week % base.length) + base.length) % base.length];
}
