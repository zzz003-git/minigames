/**
 * ⑭ 이겨라 / 져라 — BATCH
 *
 * 상대의 손과 지시(이겨라 / 져라 / 비겨라)가 함께 나옵니다. 1초 안에 맞는 손을 고르세요.
 * 틀리거나 시간을 넘기면 즉시 종료. 광고 보상은 오답 1회 면제입니다.
 *
 * 가위바위보지만 운 게임이 아닙니다 — 정답은 이미 정해져 있고, 재는 것은 판단 속도입니다.
 */

import { ARCADE } from "../../lib/config.js";
import { randomInt } from "../../lib/crypto.js";
import { decay, gradeStreak, streakMetric } from "../../lib/arcade.js";

const C = ARCADE.RPSFLASH;

/** 이기는 손: rock ← paper, scissors ← rock, paper ← scissors */
const BEATS = { rock: "scissors", scissors: "paper", paper: "rock" };
const LOSES_TO = { rock: "paper", scissors: "rock", paper: "scissors" };

const perLimit = (no) => Math.round(decay(no, C.PER_START_MS, C.PER_STEP_MS, C.PER_MIN_MS));

function answerFor(hand, order) {
  if (order === "WIN") return LOSES_TO[hand]; // 상대를 이기는 손
  if (order === "LOSE") return BEATS[hand]; // 상대에게 지는 손
  return hand; // DRAW
}

function makeItem(no) {
  const hand = C.HANDS[randomInt(0, C.HANDS.length - 1)];
  const order = C.ORDERS[randomInt(0, C.ORDERS.length - 1)];
  return { hand, order, limit_ms: perLimit(no), answer: answerFor(hand, order) };
}

export const spec = {
  game: "RPSFLASH",
  mode: "BATCH",
  boostLabel: "오답 1회 면제",

  makeBatch(meta) {
    const items = Array.from({ length: C.BATCH_SIZE }, (_, i) => makeItem(i + 1));
    meta.ext.forgive = 0;

    return {
      pub: {
        items: items.map(({ hand, order, limit_ms }) => ({ hand, order, limit_ms })),
        hands: C.HANDS,
      },
      secret: { answers: items.map((i) => i.answer), limits: items.map((i) => i.limit_ms) },
      // 문항 제한 시간의 합이 곧 이론상 최대 플레이 시간입니다.
      limitMs: items.reduce((sum, i) => sum + i.limit_ms, 0),
    };
  },

  applyBoost(meta) {
    meta.ext.forgive = (meta.ext.forgive ?? 0) + 1;
    return { data: { forgive: meta.ext.forgive } };
  },

  gradeBatch({ answers, times, meta, roundSecret }) {
    const graded = gradeStreak({
      answers,
      times,
      expected: roundSecret?.answers ?? [],
      limits: roundSecret?.limits ?? [],
      forgive: meta.ext.forgive ?? 0,
      minAnswerMs: C.MIN_ANSWER_MS,
    });

    return {
      cleared: graded.streak,
      correct: graded.streak,
      score: graded.streak,
      suspect: graded.suspect,
      ext: { streak: graded.streak, avg_ms: graded.avgMs == null ? null : Math.round(graded.avgMs) },
      detail: {
        streak: graded.streak,
        answered: graded.answered,
        forgiven: graded.forgiven,
        wrong_at: graded.wrongAt,
        avg_ms: graded.avgMs == null ? null : Math.round(graded.avgMs),
      },
    };
  },

  bucketOf: () => "all",
  rankMetricOf: (meta) => streakMetric(meta.ext.streak ?? 0, meta.ext.avg_ms),
  scoreOf: (meta) => meta.ext.streak ?? 0,
};
