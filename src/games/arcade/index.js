/**
 * 아케이드 게임 spec 레지스트리
 *
 * 게임을 추가할 때 손대는 곳은 여기와 src/lib/config.js 의 ARCADE 두 군데뿐입니다.
 * 라우터(src/index.js)·광고(src/routes/ad.js)·통계(src/routes/stats.js)는
 * 이 목록에서 자동으로 파생되므로 수정할 필요가 없습니다.
 */

import { spec as reaction } from "./reaction.js";
import { spec as oddcolor } from "./oddcolor.js";
import { spec as sequence } from "./sequence.js";
import { spec as numtap } from "./numtap.js";
import { spec as mathrush } from "./mathrush.js";
import { spec as stroop } from "./stroop.js";
import { spec as ringstop } from "./ringstop.js";
import { spec as countdot } from "./countdot.js";
import { spec as cardpair } from "./cardpair.js";
import { spec as rpsflash } from "./rpsflash.js";
import { spec as majority } from "./majority.js";
import { spec as basket } from "./basket.js";
import { spec as pathline } from "./pathline.js";
import { spec as dropcatch } from "./dropcatch.js";
import { spec as store } from "./store.js";
import { spec as scratch } from "./scratch.js";
import { spec as stack } from "./stack.js";
import { spec as detective } from "./detective.js";
import { spec as rhythm } from "./rhythm.js";
import { spec as balance } from "./balance.js";
import { spec as pour } from "./pour.js";
import { spec as merge3 } from "./merge3.js";
import { spec as gauge } from "./gauge.js";

export const ARCADE_SPECS = {
  REACTION: reaction,
  ODDCOLOR: oddcolor,
  SEQUENCE: sequence,
  NUMTAP: numtap,
  MATHRUSH: mathrush,
  STROOP: stroop,
  RINGSTOP: ringstop,
  COUNTDOT: countdot,
  CARDPAIR: cardpair,
  RPSFLASH: rpsflash,
  MAJORITY: majority,
  BASKET: basket,
  PATHLINE: pathline,
  DROPCATCH: dropcatch,
  STORE: store,
  SCRATCH: scratch,
  STACK: stack,
  DETECTIVE: detective,
  RHYTHM: rhythm,
  BALANCE: balance,
  POUR: pour,
  MERGE3: merge3,
  GAUGE: gauge,
};

export const isArcade = (gameType) => Object.hasOwn(ARCADE_SPECS, gameType);

/** 라우터에서 game_type 으로 spec 을 찾습니다. */
export const arcadeSpec = (gameType) => ARCADE_SPECS[gameType] ?? null;
