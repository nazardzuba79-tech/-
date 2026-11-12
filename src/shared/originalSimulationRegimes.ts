/** Hand-authored simulation parameters. No historical observations or fitted statistics. */
export const ORIGINAL_MODEL_VERSION = 'voltex-original-regimes-v1' as const;
export const ORIGINAL_REGIMES = [
  { id: 'G01', title: 'Плавный тренд с остановками', hours: 168, drift: .24, levels: [0,.04,.035,.11,.10,.18,0], noise: .004, persistence: .25 },
  { id: 'G02', title: 'Диапазон с ложными выходами', hours: 96, drift: 0, levels: [0,.07,-.04,.09,-.06,.03,0], noise: .008, persistence: -.2 },
  { id: 'G03', title: 'Сжатие и прорыв', hours: 120, drift: .18, levels: [0,.01,-.01,.015,.24,.13,0], noise: .006, persistence: .45 },
  { id: 'G04', title: 'Импульс и повторная проверка уровня', hours: 72, drift: .15, levels: [0,.02,.27,.12,.17,.08,0], noise: .009, persistence: .35 },
  { id: 'G05', title: 'Ступени с глубокими откатами', hours: 192, drift: .28, levels: [0,.17,-.03,.21,-.02,.24,0], noise: .01, persistence: .3 },
  { id: 'G06', title: 'Снижение с отскоками', hours: 144, drift: -.25, levels: [0,-.07,.035,-.1,.04,-.08,0], noise: .007, persistence: .15 },
  { id: 'G07', title: 'Капитуляция и стабилизация', hours: 96, drift: -.12, levels: [0,-.015,-.08,-.42,-.14,-.025,0], noise: .013, persistence: .4 },
  { id: 'G08', title: 'Восстановление через основание', hours: 240, drift: .13, levels: [0,-.2,-.24,-.21,-.11,-.05,0], noise: .005, persistence: .1 },
  { id: 'G09', title: 'Распределение и разворот', hours: 216, drift: -.17, levels: [0,.19,.22,.17,.2,.04,0], noise: .008, persistence: -.1 },
  { id: 'G10', title: 'Двойная проверка поддержки', hours: 168, drift: .07, levels: [0,-.19,-.06,-.2,-.04,.07,0], noise: .007, persistence: .05 },
  { id: 'G11', title: 'Расширяющийся диапазон', hours: 120, drift: .01, levels: [0,.035,-.06,.11,-.18,.25,0], noise: .012, persistence: -.25 },
  { id: 'G12', title: 'Затухающие колебания', hours: 144, drift: -.02, levels: [0,.25,-.2,.12,-.07,.025,0], noise: .006, persistence: -.3 },
  { id: 'G13', title: 'Ускорение и охлаждение', hours: 96, drift: .22, levels: [0,.005,.035,.11,.38,.16,0], noise: .011, persistence: .5 },
  { id: 'G14', title: 'Резкое снижение и частичный выкуп', hours: 72, drift: -.07, levels: [0,.03,.05,-.36,-.15,-.08,0], noise: .014, persistence: .25 },
  { id: 'G15', title: 'Длительная консолидация', hours: 288, drift: .025, levels: [0,.025,-.02,.018,-.015,.012,0], noise: .003, persistence: -.35 },
  { id: 'G16', title: 'Короткие всплески в боковике', hours: 48, drift: 0, levels: [0,.16,.01,-.14,.02,.12,0], noise: .009, persistence: -.05 },
  { id: 'G17', title: 'Возрастающие волны', hours: 192, drift: .2, levels: [0,.04,-.025,.12,-.045,.22,0], noise: .008, persistence: .2 },
  { id: 'G18', title: 'Серия неудачных пробоев', hours: 144, drift: -.08, levels: [0,.15,-.01,.13,-.025,.09,0], noise: .01, persistence: -.15 },
  { id: 'G19', title: 'Тихий рынок со сменой волатильности', hours: 240, drift: .04, levels: [0,.015,.01,-.16,.2,.025,0], noise: .005, persistence: .15 },
  { id: 'G20', title: 'Чередование направленных импульсов', hours: 120, drift: .03, levels: [0,.22,-.18,.25,-.23,.14,0], noise: .013, persistence: .4 },
] as const;

export type OriginalRegimeId = typeof ORIGINAL_REGIMES[number]['id'];
export interface OriginalRegimeConfig {
  version: typeof ORIGINAL_MODEL_VERSION;
  id: OriginalRegimeId | 'AUTO';
  disclosure: 'SIMULATED_ORIGINAL_MODEL';
}

export const ORIGINAL_PROVENANCE = Object.freeze({
  mode: 'DEMO_MODEL' as const,
  model: ORIGINAL_MODEL_VERSION,
  origin: 'ORIGINAL_GENERATIVE' as const,
  historicalDataUsed: false,
  priceAndVolume: 'SIMULATED' as const,
  withdrawable: false as const,
});
