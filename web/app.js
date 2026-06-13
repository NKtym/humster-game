"use strict";

const $ = (sel) => document.querySelector(sel);

const CURRENCY_LABELS = {
  seeds: 'Семечки',
  wheat: 'Пшеница',
  carrot: 'Морковь',
  cucumber: 'Огурцы',
  apple: 'Яблоки',
  kormik: 'Кормик',
};

const CURRENCY_ICONS = {
  seeds: '/assets/economy/resources/seeds.png',
  wheat: '/assets/economy/resources/wheat.png',
  carrot: '/assets/economy/resources/carrot.png',
  cucumber: '/assets/economy/resources/cucumber.png',
  apple: '/assets/economy/resources/apple.png',
  kormik: '/assets/economy/resources/kormik.png',
  energy: '/assets/economy/resources/energy.png',
};

const BATTLE_DAMAGE_ACHIEVEMENTS = (() => {
  const thresholds = [];
  let value = 100;
  const maxThreshold = 2000000;
  while (value < maxThreshold) {
    thresholds.push(value);
    value *= 5;
  }
  if (thresholds[thresholds.length - 1] !== maxThreshold) {
    thresholds.push(maxThreshold);
  }
  return thresholds;
})();

const ECONOMY_ACHIEVEMENTS = [
  { key: 'seeds', label: 'Семечки', form: 'семечек', icon: CURRENCY_ICONS.seeds },
  { key: 'wheat', label: 'Пшеница', form: 'пшеницы', icon: CURRENCY_ICONS.wheat },
  { key: 'carrot', label: 'Морковь', form: 'моркови', icon: CURRENCY_ICONS.carrot },
  { key: 'cucumber', label: 'Огурцы', form: 'огурцов', icon: CURRENCY_ICONS.cucumber },
  { key: 'apple', label: 'Яблоки', form: 'яблок', icon: CURRENCY_ICONS.apple },
  { key: 'kormik', label: 'Кормик', form: 'кормика', icon: CURRENCY_ICONS.kormik },
];

const ECONOMY_ACHIEVEMENT_THRESHOLDS = (() => {
  const thresholds = [];
  let value = 10;
  while (value <= 10000000) {
    thresholds.push(value);
    value *= 10;
  }
  return thresholds;
})();

const LEADERBOARD_PERIODS = [
  { key: 'day', label: 'За день', rewardText: '1 место: 50 семечек, 5 пшеницы и 1 морковь' },
  { key: 'week', label: 'За неделю', rewardText: '1 место: 200 семечек, 15 пшеницы, 6 моркови и 2 огурца' },
  { key: 'month', label: 'За месяц', rewardText: '1 место: 2000 семечек, 50 пшеницы, 20 моркови, 10 огурцов, 2 яблока и 1 кормик' },
];

const LEADERBOARD_REFRESH_MS = 180000;
const SOCIAL_SNAPSHOT_REFRESH_MS = 180000;

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) ? window.APP_CONFIG.apiBaseUrl : '/api';
const SESSION_KEY = 'humster_session_id';
const AUTH_TOKEN_KEY = 'humster_auth_token';
const VIEW_KEY = 'humster_view';

function getSavedView() {
  const saved = localStorage.getItem(VIEW_KEY);
  return ['main', 'battle', 'adventure', 'adventure-select', 'business', 'exchange', 'edit', 'talents'].includes(saved) ? saved : 'main';
}

function setView(nextView) {
  view = ['main', 'battle', 'adventure', 'adventure-select', 'business', 'exchange', 'edit', 'talents'].includes(nextView) ? nextView : 'main';
  localStorage.setItem(VIEW_KEY, view);
}

function restoreViewFromState(state) {
  if (state && state.activeBossId && bossById(state, state.activeBossId)) {
    setView('battle');
  }
}

const ADVENTURE_DEFS = [
  { id: 'stage5', label: 'Бежать по полю', image: '/assets/maps/adventure/stage5.png', x: 33.5, y: 24.8, energyCost: 1, requiredPasses: 4 },
  { id: 'stage4', label: 'Собирать пшеницу', image: '/assets/maps/adventure/stage4.png', x: 67.6, y: 26.8, energyCost: 2, requiredPasses: 4 },
  { id: 'stage3', label: 'Собирать орешки для белочки', image: '/assets/maps/adventure/stage3.png', x: 86.1, y: 53.3, energyCost: 3, requiredPasses: 5 },
  { id: 'stage2', label: 'Делать домик', image: '/assets/maps/adventure/stage2.png', x: 52.3, y: 80.1, energyCost: 3, requiredPasses: 6 },
  { id: 'stage1', label: 'Строить мост через ручей', image: '/assets/maps/adventure/stage1.png', x: 26.7, y: 50.8, energyCost: 4, requiredPasses: 6 },
];

const CATALOG = {
  wallpapers: [
    { id: 'wallpaper_day', name: 'Дневное поле', slot: 'wallpaper', img: '/assets/backgrounds/wallpapers/field_day.png' },
    { id: 'wallpaper_sunset', name: 'Закатное поле', slot: 'wallpaper', img: '/assets/backgrounds/wallpapers/field_sunset.png' },
    { id: 'wallpaper_night', name: 'Ночное поле', slot: 'wallpaper', img: '/assets/backgrounds/wallpapers/field_night.png' },
  ],
  bosses: [
    { id: 'rat', name: 'Крыса', img: '/assets/characters/bosses/rat.png' },
    { id: 'lizard', name: 'Ящерица', img: '/assets/characters/bosses/lizard.png' },
    { id: 'swagusinitsa', name: 'Свагусиница', img: '/assets/characters/bosses/swagusinitsa.png' },
    { id: 'sand_lizard', name: 'Песчаная ящерица', img: '/assets/characters/bosses/sand_lizard.png' },
    { id: 'sand_snake', name: 'Песчаная змея', img: '/assets/characters/bosses/sand_snake.png' },
    { id: 'cave_centipede', name: 'Пещерная многоножка', img: '/assets/characters/bosses/cave_centipede.png' },
    { id: 'cave_bird', name: 'Пещерная птица', img: '/assets/characters/bosses/cave_bird.png' },
    { id: 'cave_spider', name: 'Пещерный паук', img: '/assets/characters/bosses/cave_spider.png' },
    { id: 'honey_badger', name: 'Медоед', img: '/assets/characters/bosses/honey_badger.png' },
  ],
  adventure: ADVENTURE_DEFS,
};

const APPEARANCE_CATEGORIES = [
  { id: 'background', label: 'Фон', icon: '🌿', slot: 'background' },
  { id: 'color', label: 'Окрас', icon: '🎨', slot: 'color' },
  { id: 'heldItem', label: 'В лапках', icon: '🫳', slot: 'heldItem' },
  { id: 'headwear', label: 'Кепка', icon: '🧢', slot: 'headwear' },
  { id: 'glasses', label: 'Очки', icon: '👓', slot: 'glasses' },
  { id: 'mask', label: 'Маска', icon: '🎭', slot: 'mask' },
  { id: 'body', label: 'Тело', icon: '🧥', slot: 'body' },
  { id: 'shoes', label: 'Ноги', icon: '👟', slot: 'shoes' },
];

const APPEARANCE_OPTIONS = {
  background: [
    { id: 'wallpaper_day', name: 'Дневное поле', img: '/assets/backgrounds/wallpapers/field_day.png' },
  ],
  color: [
    { id: 'default', name: 'Базовый', img: '/assets/characters/hamster/layers/base.png' },
    { id: 'color1', name: 'Зеленый', img: '/assets/characters/hamster/layers/color1.png' },
    { id: 'color2', name: 'Серый', img: '/assets/characters/hamster/layers/color2.png' },
  ],
  heldItem: [
    { id: 'none', name: 'Без предмета' },
    { id: 'flower', name: 'Цветок' },
    { id: 'seed_bag', name: 'Мешочек семечек' },
    { id: 'carrot', name: 'Морковка' },
  ],
  headwear: [
    { id: 'none', name: 'Без кепки' },
    { id: 'cap', name: 'Кепка' },
    { id: 'beanie', name: 'Шапка' },
  ],
  glasses: [
    { id: 'none', name: 'Без очков' },
    { id: 'glasses_round', name: 'Очки' },
    { id: 'glasses_sun', name: 'Солнцезащитные' },
  ],
  mask: [
    { id: 'none', name: 'Без маски' },
    { id: 'mask_simple', name: 'Маска' },
    { id: 'scarf', name: 'Шарфик' },
  ],
  body: [
    { id: 'none', name: 'Без одежды' },
    { id: 'jacket', name: 'Куртка' },
    { id: 'hoodie', name: 'Худи' },
  ],
  shoes: [
    { id: 'none', name: 'Без обуви' },
    { id: 'sneakers', name: 'Кроссовки' },
    { id: 'boots', name: 'Ботинки' },
  ],
};

const ADVENTURE_REWARDS = [
  { xp: 1, seeds: 2 },
  { xp: 2, seeds: 3 },
  { xp: 3, seeds: 5 },
  { xp: 3, seeds: 6 },
  { xp: 3, seeds: 10 },
];

const telegram = window.Telegram?.WebApp || null;
if (telegram) {
  telegram.ready();
  telegram.expand();
  try {
    telegram.setHeaderColor?.('#5b3216');
    telegram.setBackgroundColor?.('#5b3216');
  } catch (_) {
    // no-op
  }
}

const ATTACKS = [
  { id: 'belly_punch', label: 'Удар пузиком', damage: 5, costWheat: 0, icon: '/assets/combat/attacks/belly_punch.png' },
  { id: 'scratch', label: 'Царапанье', damage: 20, costWheat: 0, icon: '/assets/combat/attacks/scratch.png' },
  { id: 'rush', label: 'Удар с разбега', damage: 15, costWheat: 0, icon: '/assets/combat/attacks/rush.png' },
  { id: 'bite', label: 'Укус', damage: 30, costWheat: 0, icon: '/assets/combat/attacks/bite.png' },
  { id: 'iron_claw', label: 'Удар железным когтем', damage: 100, costWheat: 2, icon: '/assets/combat/attacks/iron_claw.png' },
  { id: 'poison_bite', label: 'Ядовитый укус', damage: 300, costWheat: 6, icon: '/assets/combat/attacks/poison_bite.png' },
  { id: 'eye_lasers', label: 'Лазеры из глаз', damage: 700, costWheat: 13, icon: '/assets/combat/attacks/eye_lasers.png' },
];

const BOSS_KILL_LIMIT = 8;
const BOSS_PASS_ACHIEVEMENT_THRESHOLDS = [1, 5, 10, 25, 50, 100];
const TALENT_POINTS_SPENT_ACHIEVEMENT_THRESHOLDS = [1, 10, 25, 50, 100, 150, 200];

const BOSS_BLUEPRINTS = {
  rat: { name: 'Крыса', hp: 70, attack: 4, xp: 10, reward: { seeds: 20, wheat: 2, carrot: 1, cucumber: 0 } },
  lizard: { name: 'Ящерица', hp: 150, attack: 8, xp: 20, reward: { seeds: 50, wheat: 3, carrot: 0, cucumber: 1 } },
  swagusinitsa: { name: 'Свагусиница', hp: 600, attack: 12, xp: 50, reward: { seeds: 200, wheat: 0, carrot: 2, cucumber: 1 } },
  sand_lizard: { name: 'Песчаная ящерица', hp: 7000, attack: 16, xp: 300, reward: { seeds: 1000, wheat: 0, carrot: 5, cucumber: 2 } },
  sand_snake: { name: 'Песчаная змея', hp: 15000, attack: 24, xp: 500, reward: { seeds: 2000, wheat: 10, carrot: 10, cucumber: 4 } },
  cave_centipede: { name: 'Пещерная многоножка', hp: 1200, attack: 14, xp: 100, reward: { seeds: 400, wheat: 0, carrot: 2, cucumber: 1 } },
  cave_bird: { name: 'Пещерная птица', hp: 3400, attack: 18, xp: 200, reward: { seeds: 500, wheat: 0, carrot: 3, cucumber: 2 } },
  cave_spider: { name: 'Пещерный паук', hp: 24000, attack: 32, xp: 800, reward: { seeds: 2000, wheat: 0, carrot: 8, cucumber: 2, apple: 1 } },
  honey_badger: { name: 'Медоед', hp: 1000000, attack: 40, xp: 15000, reward: { seeds: 25000, wheat: 25, carrot: 30, cucumber: 10, apple: 2 } },
};

const BOSS_COSMETIC_DROPS = {
  rat: { itemId: 'color2', label: 'серый скин хомяка', chance: 25, bonus: '+5 к удару пузиком и +5 к удару железным когтем' },
  lizard: { itemId: 'color1', label: 'зеленый скин хомяка', chance: 25, bonus: '+20 к урону ядовитого укуса' },
};

const BOSS_COSMETIC_ITEM_BONUSES = {
  color2: {
    name: 'серый скин хомяка',
    bonus: '+5 к удару пузиком и +5 к удару железным когтем',
  },
  color1: {
    name: 'зеленый скин хомяка',
    bonus: '+20 к урону ядовитого укуса',
  },
};

function bossCosmeticDrop(bossId) {
  return BOSS_COSMETIC_DROPS[bossId] || null;
}

function bossRewardText(boss) {
  const base = formatReward(boss?.reward || {});
  const drop = bossCosmeticDrop(boss?.id || '');
  if (!drop) return base;
  return `${base}, случайно: ${drop.label} (${drop.chance}%) — ${drop.bonus}`;
}

function cryptoRandomInt(maxExclusive) {
  const max = Math.max(1, Number(maxExclusive) || 1);
  if (window.crypto?.getRandomValues) {
    const range = 0x100000000;
    const limit = Math.floor(range / max) * max;
    const buf = new Uint32Array(1);
    let value = 0;
    do {
      window.crypto.getRandomValues(buf);
      value = buf[0];
    } while (value >= limit);
    return value % max;
  }
  return Math.floor(Math.random() * max);
}

function maybeGrantBossCosmeticDrop(state, boss) {
  const drop = bossCosmeticDrop(boss?.id || '');
  if (!drop || !state?.player) return null;
  if (cryptoRandomInt(100) >= drop.chance) return null;
  state.player.inventory = state.player.inventory || {};
  const alreadyOwned = (state.player.inventory[drop.itemId] || 0) > 0;
  state.player.inventory[drop.itemId] = (state.player.inventory[drop.itemId] || 0) + 1;
  if (Array.isArray(state.log)) {
    state.log.push(`Случайная награда: получен ${drop.label}.`);
    if (!alreadyOwned) {
      state.log.push(`Бонус за скин: ${drop.bonus}.`);
    }
    if (state.log.length > 100) state.log = state.log.slice(-100);
  }
  return drop;
}

function getAmsterdamDayKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

function bossKillDayKey() {
  return getAmsterdamDayKey(new Date());
}

function refreshBossKillLimit(state) {
  if (!state) return state;
  const today = bossKillDayKey();
  for (const boss of state.bosses || []) {
    if (!boss || typeof boss !== 'object') continue;
    const dayChanged = boss.killsDay !== today;
    if (dayChanged) {
      boss.killsDay = today;
      boss.killsToday = 0;
      boss.defeated = false;
      boss.hp = clampNumber(boss.maxHp ?? boss.hp, 1, 999999);
      const now = Date.now();
      boss.battleStartedAt = new Date(now).toISOString();
      boss.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
      boss.attackCooldowns = {};
    }
    boss.killsToday = clampNumber(boss.killsToday, 0, BOSS_KILL_LIMIT);
  }
  return state;
}

function xpForNextLevel(level) {
  const safeLevel = Math.max(1, Number(level) || 1);
  return 10 * (2 ** (safeLevel - 1));
}

function recalcLevel(state) {
  if (!state || !state.player) return state;
  const player = state.player;
  player.level = Math.max(1, Number(player.level) || 1);
  player.xp = Math.max(0, Number(player.xp) || 0);
  while (player.xp >= xpForNextLevel(player.level)) {
    player.xp -= xpForNextLevel(player.level);
    player.level += 1;
    player.maxHp = Math.max(1, Number(player.maxHp) || 1) + 2;
    player.hp = player.maxHp;
    player.attack = Math.max(0, Number(player.attack) || 0) + 1;
    player.defense = Math.max(0, Number(player.defense) || 0) + 1;
    if (Array.isArray(state.log)) {
      state.log.push(`Уровень повышен! Теперь уровень ${player.level}.`);
      if (state.log.length > 100) state.log = state.log.slice(-100);
    }
  }
  return state;
}

const DEFAULT_STATE = {
  player: {
    name: 'Хомяк',
    level: 1,
    xp: 0,
    hp: 10,
    maxHp: 10,
    energy: 40,
    maxEnergy: 40,
    attack: 2,
    defense: 0,
    currency: { seeds: 10, wheat: 3, carrot: 0, cucumber: 0, apple: 0, kormik: 0 },
    inventory: { wallpaper_day: 1, iron_claw: 0, poison_bite: 0, eye_lasers: 0 },
    equipped: { wallpaper: 'wallpaper_day' },
    wallpaper: 'wallpaper_day',
    appearance: {
      background: 'wallpaper_day',
      color: 'default',
      heldItem: 'none',
      headwear: 'none',
      glasses: 'none',
      mask: 'none',
      body: 'none',
      shoes: 'none',
    },
    talentClass: '',
    talentPoints: 0,
    talentDamageProgress: 0,
    talentNextThreshold: 70,
    talents: {},
  },
  location: 'Поле',
  bosses: [
    { id: 'rat', name: 'Крыса', hp: 70, maxHp: 70, attack: 4, reward: { seeds: 20, wheat: 2, carrot: 1, cucumber: 0 }, xp: 10, defeated: false, battleStartedAt: '', battleEndsAt: '', attackCooldowns: {}, killsToday: 0, killsDay: '', killsTotal: 0 },
    { id: 'lizard', name: 'Ящерица', hp: 150, maxHp: 150, attack: 8, reward: { seeds: 50, wheat: 3, carrot: 0, cucumber: 1 }, xp: 20, defeated: false, battleStartedAt: '', battleEndsAt: '', attackCooldowns: {}, killsToday: 0, killsDay: '', killsTotal: 0 },
    { id: 'sand_lizard', name: 'Песчаная ящерица', hp: 600, maxHp: 600, attack: 16, reward: { seeds: 200, wheat: 0, carrot: 3, cucumber: 1 }, xp: 50, defeated: false, battleStartedAt: '', battleEndsAt: '', attackCooldowns: {}, killsToday: 0, killsDay: '', killsTotal: 0 },
  ],
  activeBossId: '',
  locationPasses: 0,
  bossDamageDay: 0,
  bossDamageDayKey: damageDayKey(),
  bossDamageWeek: 0,
  bossDamageWeekKey: damageWeekKey(),
  bossDamageMonth: 0,
  bossDamageMonthKey: damageMonthKey(),
  bossDamageAllTime: 0,
  bossBattleDamageCurrent: 0,
  bossBattleDamageBest: 0,
  economyTotals: { seeds: 0, wheat: 0, carrot: 0, cucumber: 0, apple: 0, kormik: 0 },
  adventure: ADVENTURE_DEFS.map((node) => ({
    id: node.id,
    name: node.label,
    energyCost: node.energyCost,
    requiredPasses: node.requiredPasses,
    progress: 0,
    completed: false,
  })),
  activeAdventureId: 'stage5',
  business: {
    shopLevel: 0,
    shopLastClaimAt: '',
    wheelLevel: 0,
    wheelLastClaimAt: '',
  },
  log: ['Добро пожаловать в поле хомяков.'],
  updatedAt: new Date().toISOString(),
  lastEnergyRegenAt: new Date().toISOString(),
};

let currentState = structuredClone(DEFAULT_STATE);
let view = getSavedView();
let editCategory = 'background';
let pendingAdventureShakeId = null;
let previewReturnToProfile = false;
let isAuthenticated = false;
let currentUserLogin = '';

function getSessionId() {
  let sid = localStorage.getItem(SESSION_KEY);
  if (sid) return sid;
  sid = window.crypto?.randomUUID ? window.crypto.randomUUID() : `sid-${Math.random().toString(16).slice(2)}-${Date.now()}`;
  localStorage.setItem(SESSION_KEY, sid);
  return sid;
}

function apiUrl(path) {
  const base = API_BASE.endsWith('/') ? API_BASE.slice(0, -1) : API_BASE;
  const tail = path.startsWith('/') ? path : `/${path}`;
  return `${base}${tail}`;
}

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

function setAuthToken(token) {
  if (token) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(AUTH_TOKEN_KEY);
  }
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getAuthToken();
  if (token) {
    headers['X-Auth-Token'] = token;
  } else {
    headers['X-Game-Session'] = getSessionId();
  }
  return headers;
}

function normalizeLogin(login) {
  return String(login ?? '').trim().toLowerCase();
}

function jsStringLiteral(value) {
  return JSON.stringify(String(value ?? ''));
}

async function api(path, payload, method = 'POST') {
  try {
    const res = await fetch(apiUrl(path), {
      method,
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: method === 'GET' ? undefined : JSON.stringify(payload),
    });
    const data = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, data };
  } catch (error) {
    return { ok: false, status: 0, data: null };
  }
}

async function loadState() {
  const token = getAuthToken();
  try {
    if (token) {
      const res = await fetch(apiUrl('/auth/me'), {
        method: 'GET',
        headers: authHeaders(),
      });
      const data = await res.json().catch(() => null);
      if (res.ok && data && data.ok && data.state) {
        currentState = normalizeState(data.state);
        currentUserLogin = data.user || currentState.player.name || '';
        isAuthenticated = true;
        restoreViewFromState(currentState);
        void refreshFriendsBadge(true);
        void loadSocialSnapshot(true);
        void loadLeaderboards(true);
        render();
        return;
      }
      setAuthToken('');
      isAuthenticated = false;
      currentUserLogin = '';
    }

    const res = await fetch(apiUrl('/state'), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (data && data.state) {
      currentState = normalizeState(data.state);
      restoreViewFromState(currentState);
    }
  } catch (error) {
    // Keep local fallback.
  }
  render();
}

function clampNumber(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function mergeAdventure(stateAdventure = []) {
  const map = new Map();
  for (const node of stateAdventure) {
    if (node && typeof node === 'object' && node.id) {
      map.set(node.id, node);
    }
  }
  return ADVENTURE_DEFS.map((def) => {
    const existing = map.get(def.id) || {};
    const progress = clampNumber(existing.progress ?? 0, 0, def.requiredPasses);
    return {
      id: def.id,
      name: def.label,
      energyCost: def.energyCost,
      requiredPasses: def.requiredPasses,
      progress,
      completed: Boolean(existing.completed) || progress >= def.requiredPasses,
    };

  });
}

function normalizeBosses(stateBosses = []) {
  const map = new Map();
  for (const boss of stateBosses) {
    if (boss && typeof boss === 'object' && boss.id) {
      map.set(boss.id, boss);
    }
  }
  return Object.entries(BOSS_BLUEPRINTS).map(([id, tpl]) => {
    const existing = map.get(id) || {};
    const maxHp = tpl.hp;
    const killsToday = clampNumber(existing.killsToday ?? 0, 0, BOSS_KILL_LIMIT);
    const killsDay = existing.killsDay || bossKillDayKey();
    const bestClearSeconds = clampNumber(existing.bestClearSeconds ?? 0, 0, 9999999);
    const reward = { ...(existing.reward && typeof existing.reward === 'object' ? existing.reward : {}) };
    reward.seeds = tpl.reward.seeds;
    reward.wheat = tpl.reward.wheat;
    reward.carrot = tpl.reward.carrot;
    reward.cucumber = tpl.reward.cucumber;
    const attackCooldowns = existing.attackCooldowns && typeof existing.attackCooldowns === 'object' ? { ...existing.attackCooldowns } : {};
    const defeated = Boolean(existing.defeated) || clampNumber(existing.hp ?? maxHp, 0, maxHp) <= 0;
    const killsTotal = clampNumber(existing.killsTotal ?? 0, 0, 9999999);

    return {
      ...existing,
      id,
      name: tpl.name,
      hp: defeated ? 0 : clampNumber(existing.hp ?? maxHp, 0, maxHp),
      maxHp,
      attack: tpl.attack,
      reward,
      xp: tpl.xp,
      defeated,
      battleStartedAt: defeated ? '' : cleanTimestamp(existing.battleStartedAt),
      battleEndsAt: defeated ? '' : cleanTimestamp(existing.battleEndsAt),
      attackCooldowns: defeated ? {} : Object.fromEntries(Object.entries(attackCooldowns).filter(([, v]) => cleanTimestamp(v))),
      killsToday,
      killsDay,
      killsTotal,
      bestClearSeconds,
    };
  });
}

function normalizeBossTimers(state) {
  const next = state;
  const now = Date.now();
  const bosses = Array.isArray(next?.bosses) ? next.bosses : [];
  let changed = false;

  for (const boss of bosses) {
    if (!boss || typeof boss !== 'object') continue;
    if (boss.killsDay !== bossKillDayKey()) {
      boss.killsDay = bossKillDayKey();
      boss.killsToday = 0;
      changed = true;
    }
    if (!boss.defeated && cleanTimestamp(boss.battleEndsAt)) {
      const endsAt = toMillis(boss.battleEndsAt);
      if (endsAt && now > endsAt) {
        boss.hp = boss.maxHp;
        boss.battleStartedAt = '';
        boss.battleEndsAt = '';
        boss.attackCooldowns = {};
        if (next.activeBossId === boss.id) next.activeBossId = '';
        changed = true;
      }
    }
    if (boss.defeated) {
      boss.battleStartedAt = '';
      boss.battleEndsAt = '';
      boss.attackCooldowns = {};
    } else if (!cleanTimestamp(boss.battleStartedAt) && cleanTimestamp(boss.battleEndsAt)) {
      boss.battleStartedAt = new Date(Math.max(0, toMillis(boss.battleEndsAt) - (8 * 60 * 60 * 1000))).toISOString();
    } else {
      boss.battleStartedAt = cleanTimestamp(boss.battleStartedAt);
      boss.battleEndsAt = cleanTimestamp(boss.battleEndsAt);
    }
  }
  return changed;
}

function normalizeState(state) {
  const next = structuredClone(DEFAULT_STATE);
  if (!state || typeof state !== 'object') return next;

  next.player = { ...next.player, ...(state.player || {}) };
  next.player.name = next.player.name || DEFAULT_STATE.player.name;
  next.player.level = Math.max(1, Number(next.player.level) || 1);
  next.player.xp = Math.max(0, Number(next.player.xp) || 0);
  next.player.hp = clampNumber(next.player.hp || DEFAULT_STATE.player.hp, 1, 999999);
  next.player.maxHp = clampNumber(next.player.maxHp || DEFAULT_STATE.player.maxHp, 1, 999999);
  next.player.maxEnergy = Math.max(40, Number(next.player.maxEnergy ?? DEFAULT_STATE.player.maxEnergy) || 40);
  next.player.energy = clampNumber(next.player.energy ?? DEFAULT_STATE.player.energy, 0, next.player.maxEnergy);
  next.player.attack = Math.max(0, Number(next.player.attack) || DEFAULT_STATE.player.attack);
  next.player.defense = Math.max(0, Number(next.player.defense) || DEFAULT_STATE.player.defense);
  next.player.currency = { ...DEFAULT_STATE.player.currency, ...((state.player && state.player.currency) || {}) };
  next.player.inventory = { ...DEFAULT_STATE.player.inventory, ...((state.player && state.player.inventory) || {}) };
  next.player.equipped = { ...DEFAULT_STATE.player.equipped, ...((state.player && state.player.equipped) || {}) };
  next.player.appearance = {
    background: next.player.appearance?.background || next.player.wallpaper || 'wallpaper_day',
    color: next.player.appearance?.color || 'default',
    heldItem: next.player.appearance?.heldItem || 'none',
    headwear: next.player.appearance?.headwear || 'none',
    glasses: next.player.appearance?.glasses || 'none',
    mask: next.player.appearance?.mask || 'none',
    body: next.player.appearance?.body || 'none',
    shoes: next.player.appearance?.shoes || 'none',
  };
  if (next.player.appearance.color !== 'default' && (next.player.inventory[next.player.appearance.color] || 0) <= 0) {
    next.player.appearance.color = 'default';
  }

  next.activeBossId = state.activeBossId || '';
  next.bosses = Array.isArray(state.bosses)
    ? normalizeBosses(state.bosses)
    : structuredClone(DEFAULT_STATE.bosses);

  next.location = state.location || next.location;
  next.locationPasses = Math.max(0, Number(state.locationPasses ?? next.locationPasses) || 0);
  next.bossDamageDay = Math.max(0, Number(state.bossDamageDay ?? next.bossDamageDay) || 0);
  next.bossDamageDayKey = state.bossDamageDayKey || next.bossDamageDayKey || damageDayKey();
  next.bossDamageWeek = Math.max(0, Number(state.bossDamageWeek ?? next.bossDamageWeek) || 0);
  next.bossDamageWeekKey = state.bossDamageWeekKey || next.bossDamageWeekKey || damageWeekKey();
  next.bossDamageMonth = Math.max(0, Number(state.bossDamageMonth ?? next.bossDamageMonth) || 0);
  next.bossDamageMonthKey = state.bossDamageMonthKey || next.bossDamageMonthKey || damageMonthKey();
  next.bossDamageAllTime = Math.max(0, Number(state.bossDamageAllTime ?? next.bossDamageAllTime) || 0);
  next.bossBattleDamageCurrent = Math.max(0, Number(state.bossBattleDamageCurrent ?? next.bossBattleDamageCurrent) || 0);
  next.bossBattleDamageBest = Math.max(0, Number(state.bossBattleDamageBest ?? next.bossBattleDamageBest) || 0);
  next.economyTotals = { ...DEFAULT_STATE.economyTotals, ...((state && state.economyTotals) || {}) };
  if (next.bossBattleDamageBest < next.bossBattleDamageCurrent) {
    next.bossBattleDamageBest = next.bossBattleDamageCurrent;
  }
  normalizeDamageStats(next);
  if (typeof window.normalizeTalentState === 'function') {
    window.normalizeTalentState(next);
  }
  normalizeBossTimers(next);
  refreshBossKillLimit(next);

  next.business = {
    shopLevel: clampNumber(state?.business?.shopLevel ?? next.business?.shopLevel ?? 0, 0, 100),
    shopLastClaimAt: cleanTimestamp(state?.business?.shopLastClaimAt || next.business?.shopLastClaimAt || ''),
    wheelLevel: clampNumber(state?.business?.wheelLevel ?? next.business?.wheelLevel ?? 0, 0, 100),
    wheelLastClaimAt: cleanTimestamp(state?.business?.wheelLastClaimAt || next.business?.wheelLastClaimAt || ''),
  };

  next.adventure = mergeAdventure(state.adventure);
  next.activeAdventureId = state.activeAdventureId && next.adventure.some((node) => node.id === state.activeAdventureId)
    ? state.activeAdventureId
    : next.adventure.find((node) => !node.completed)?.id || next.adventure[0]?.id || '';

  next.log = Array.isArray(state.log) ? [...state.log] : [...next.log];
  next.updatedAt = state.updatedAt || next.updatedAt;
  next.lastEnergyRegenAt = state.lastEnergyRegenAt || next.lastEnergyRegenAt;
  return next;
}


function toMillis(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
}

function cleanTimestamp(value) {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : '';
}

function formatCountdown(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function timeRemainingLabel(isoString) {
  const ms = toMillis(isoString);
  if (!ms) return '';
  return formatCountdown(ms - Date.now());
}

function advanceLocalEnergy(state) {
  if (!state || !state.player) return state;
  const next = state;
  const now = Date.now();
  const maxEnergy = Math.max(1, Number(next.player.maxEnergy) || 40);
  const energy = clampNumber(next.player.energy, 0, maxEnergy);
  const lastTick = toMillis(next.lastEnergyRegenAt) || now;

  next.player.maxEnergy = maxEnergy;
  next.player.energy = energy;
  if (!next.lastEnergyRegenAt || !toMillis(next.lastEnergyRegenAt)) {
    next.lastEnergyRegenAt = new Date(now).toISOString();
    return next;
  }

  if (energy >= maxEnergy) {
    next.player.energy = maxEnergy;
    next.lastEnergyRegenAt = new Date(now).toISOString();
    return next;
  }

  const elapsed = now - lastTick;
  if (elapsed < 4 * 60 * 1000) return next;

  const gained = Math.floor(elapsed / (4 * 60 * 1000));
  if (gained <= 0) return next;

  const missing = maxEnergy - energy;
  const applied = Math.min(gained, missing);
  next.player.energy = Math.min(maxEnergy, energy + applied);
  next.lastEnergyRegenAt = new Date(lastTick + (applied * 4 * 60 * 1000)).toISOString();

  if (next.player.energy >= maxEnergy) {
    next.player.energy = maxEnergy;
    next.lastEnergyRegenAt = new Date(now).toISOString();
  }

  return next;
}

function getEnergyCountdown(state) {
  const player = state?.player || {};
  const maxEnergy = Math.max(1, Number(player.maxEnergy) || 40);
  const energy = clampNumber(player.energy, 0, maxEnergy);
  if (energy >= maxEnergy) return 'Энергия полная';
  const lastTick = toMillis(state?.lastEnergyRegenAt);
  if (!lastTick) return '+1 через 04:00';
  const elapsed = Date.now() - lastTick;
  const remaining = (4 * 60 * 1000) - (elapsed % (4 * 60 * 1000));
  return `+1 через ${formatCountdown(remaining)}`;
}

function bossBattleCountdown(boss) {
  const endsAt = cleanTimestamp(boss?.battleEndsAt);
  if (!endsAt) return '';
  return formatCountdown(toMillis(endsAt) - Date.now());
}

function attackConsumesChargeWithoutCooldown(attackId) {
  return attackId === 'iron_claw' || attackId === 'poison_bite' || attackId === 'eye_lasers';
}

function bossAttackCooldownRemaining(boss, attackId) {
  if (attackConsumesChargeWithoutCooldown(attackId)) return '';
  const until = cleanTimestamp(boss?.attackCooldowns?.[attackId]);
  if (!until) return '';
  return formatCountdown(toMillis(until) - Date.now());
}

function bossDailyRemaining(boss) {
  if (!boss) return 0;
  const today = bossKillDayKey();
  const killsToday = boss.killsDay === today ? (boss.killsToday || 0) : 0;
  return Math.max(0, BOSS_KILL_LIMIT - killsToday);
}

function bossById(state, id) {
  return (state?.bosses || []).find((boss) => boss.id === id) || null;
}

function isBossBattleActive(state) {
  const boss = bossById(state, state?.activeBossId);
  if (!boss || boss.defeated) return false;
  const startedAt = toMillis(boss.battleStartedAt);
  const endsAt = toMillis(boss.battleEndsAt);
  return startedAt > 0 && endsAt > Date.now();
}

function getAdventureDef(id) {
  return ADVENTURE_DEFS.find((node) => node.id === id) || ADVENTURE_DEFS[0];
}

function getAdventureNode(state, id) {
  return (state?.adventure || []).find((node) => node.id === id) || null;
}

function selectedAdventureId(state) {
  if (state.activeAdventureId && getAdventureNode(state, state.activeAdventureId)) return state.activeAdventureId;
  return state.adventure.find((node) => !node.completed)?.id || state.adventure[0]?.id || '';
}

function activeAdventureNode(state) {
  return getAdventureNode(state, selectedAdventureId(state));
}

function firstIncompleteAdventureIndex(state) {
  return (state.adventure || []).findIndex((node) => !node.completed);
}

function isAdventureLocked(state, index) {
  const unlocked = firstIncompleteAdventureIndex(state);
  if (unlocked < 0) return false;
  return index > unlocked;
}

function formatReward(reward = {}) {
  const parts = Object.entries(reward)
    .filter(([, v]) => Number(v) > 0)
    .map(([k, v]) => `${v} ${CURRENCY_LABELS[k] || k}`);
  return parts.length ? parts.join(', ') : 'Награда отсутствует';
}

function adventureRewardLabel(index) {
  const reward = ADVENTURE_REWARDS[index] || { xp: 0, seeds: 0 };
  return `+${reward.xp || 0} опыта, +${reward.seeds || 0} семечек`;
}

function wallpaperName(id) {
  return (CATALOG.wallpapers.find((w) => w.id === id) || CATALOG.wallpapers[0]).name;
}

function getWallpaperAsset(id) {
  return CATALOG.wallpapers.find((w) => w.id === id) || CATALOG.wallpapers[0];
}

function getAppearanceOption(slot, value) {
  const list = APPEARANCE_OPTIONS[slot] || [];
  return list.find((item) => item.id === value) || list[0] || null;
}

function getHamsterSpriteAsset(colorValue) {
  const option = getAppearanceOption('color', colorValue || 'default');
  if (option && option.img) return option.img;
  return '/assets/characters/hamster/layers/base.png';
}

function damageDayKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function damageWeekKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const zoned = new Date(`${lookup.year}-${lookup.month}-${lookup.day}T12:00:00Z`);
  const weekday = zoned.getUTCDay() || 7;
  const monday = new Date(zoned);
  monday.setUTCDate(zoned.getUTCDate() - weekday + 1);
  const isoYear = monday.getUTCFullYear();
  const jan4 = new Date(Date.UTC(isoYear, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const week = Math.round((monday - week1Monday) / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

function damageMonthKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Amsterdam',
    year: 'numeric',
    month: '2-digit',
  }).format(date);
}

function normalizeDamageStats(state) {
  const next = state || {};
  const today = damageDayKey();
  const week = damageWeekKey();
  const month = damageMonthKey();
  next.bossDamageDay = Math.max(0, Number(next.bossDamageDay) || 0);
  next.bossDamageWeek = Math.max(0, Number(next.bossDamageWeek) || 0);
  next.bossDamageMonth = Math.max(0, Number(next.bossDamageMonth) || 0);
  next.bossDamageAllTime = Math.max(0, Number(next.bossDamageAllTime) || 0);
  if (next.bossDamageDayKey !== today) {
    next.bossDamageDay = 0;
    next.bossDamageDayKey = today;
  }
  if (next.bossDamageWeekKey !== week) {
    next.bossDamageWeek = 0;
    next.bossDamageWeekKey = week;
  }
  if (next.bossDamageMonthKey !== month) {
    next.bossDamageMonth = 0;
    next.bossDamageMonthKey = month;
  }
  if (!next.locationPasses || next.locationPasses < 0) next.locationPasses = 0;
  return next;
}

let battleFinishTargetName = '';

function ensureBattleFinishModal() {
  if (document.getElementById('battle-finish-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="battle-finish-modal" class="battle-finish-modal" hidden>
      <div class="battle-finish-modal__backdrop" data-battle-finish-close></div>
      <div class="battle-finish-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="battle-finish-title">
        <div class="eyebrow">Подтверждение</div>
        <h3 id="battle-finish-title">Выйти из битвы досрочно?</h3>
        <p id="battle-finish-text">Если хочешь выйти из битвы досрочно, нужно заплатить 1 кормик.</p>
        <div class="battle-finish-modal__actions">
          <button type="button" class="ghost" data-battle-finish-close>Отмена</button>
          <button type="button" class="primary" id="battle-finish-confirm">Выйти из битвы досрочно за 1 кормик</button>
        </div>
      </div>
    </div>
  `);
}

function openBattleFinishModal(boss) {
  ensureBattleFinishModal();
  battleFinishTargetName = boss?.name || 'этого босса';
  const modal = document.getElementById('battle-finish-modal');
  const text = document.getElementById('battle-finish-text');
  if (text) {
    text.textContent = `Если хочешь выйти из битвы с ${battleFinishTargetName} до окончания таймера, нужно заплатить 1 кормик.`;
  }
  if (modal) modal.hidden = false;
}

function closeBattleFinishModal() {
  const modal = document.getElementById('battle-finish-modal');
  if (modal) modal.hidden = true;
}

async function confirmBattleFinish() {
  closeBattleFinishModal();
  await syncAction('finish_battle', {});
  setView('battle');
  render();
}

let profileModalTarget = '';
let profileModalProfile = null;
let profileModalLoading = false;
let profileModalError = '';
let friendsModalTab = 'requests';
let friendsModalProfile = null;
let friendsModalLoading = false;
let friendsModalError = '';
let friendsBadgeCount = 0;
let friendsBadgeLoading = false;
let friendsBadgeLastLoadedAt = 0;
let friendsBadgeInterval = null;
let achievementsModalTab = 'battle';
let achievementsAccordionState = {
  battle: true,
  economy: {},
};
let leaderboardsData = null;
let leaderboardsLoading = false;
let leaderboardsError = '';
let leaderboardsLoadedAt = 0;
let leaderboardsRequestId = 0;
let socialSnapshotProfile = null;
let socialSnapshotLoading = false;
let socialSnapshotError = '';
let socialSnapshotLoadedAt = 0;
let pollingIntervalsInitialized = false;

function ensureProfileModal() {
  if (document.getElementById('profile-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="profile-modal" class="profile-modal" hidden>
      <div class="profile-modal__backdrop" data-profile-close></div>
      <div class="profile-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="profile-title">
        <div class="profile-modal__head">
          <div>
            <div class="eyebrow">Профиль игрока</div>
            <h3 id="profile-title">Профиль хомяка</h3>
          </div>
          <button type="button" class="ghost" data-profile-close>Закрыть</button>
        </div>
        <div id="profile-modal-error" class="auth-error" aria-live="polite"></div>
        <div id="profile-modal-body" class="profile-modal__body"></div>
      </div>
    </div>
  `);
}

function ensureFriendsModal() {
  if (document.getElementById('friends-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="friends-modal" class="social-modal" hidden>
      <div class="social-modal__backdrop" data-friends-close></div>
      <div class="social-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="friends-title">
        <div class="social-modal__head">
          <div>
            <div class="eyebrow">Друзья</div>
            <h3 id="friends-title">Друзья</h3>
          </div>
          <button type="button" class="ghost" data-friends-close>Закрыть</button>
        </div>
        <div class="social-modal__toolbar">
          <input id="friends-login-input" maxlength="32" placeholder="Логин друга" />
          <button id="btn-friends-add" type="button" class="primary" onclick="void window.humsterAddFriendFromInput()">Добавить</button>
        </div>
        <div class="social-modal__tabs">
          <button type="button" class="social-modal__tab is-active" data-friends-tab="requests">Заявки</button>
          <button type="button" class="social-modal__tab" data-friends-tab="list">Список друзей</button>
        </div>
        <div id="friends-modal-error" class="auth-error" aria-live="polite"></div>
        <div id="friends-modal-body" class="social-modal__body"></div>
      </div>
    </div>
  `);
}

function hamsterPreviewMarkup(state) {
  const appearance = state?.player?.appearance || {};
  const wallpaperId = appearance.background || state?.player?.wallpaper || state?.player?.equipped?.wallpaper || 'wallpaper_day';
  const wallpaper = getWallpaperAsset(wallpaperId);
  const hamsterSprite = getHamsterSpriteAsset(appearance.color || 'default');
  const body = appearance.body || 'none';
  const head = appearance.headwear || 'none';
  const glasses = appearance.glasses || 'none';
  const mask = appearance.mask || 'none';
  const shoes = appearance.shoes || 'none';
  const held = appearance.heldItem || 'none';

  return `
    <div class="hamster-preview">
      <div class="hamster-preview__wallpaper" style="background-image:url('${wallpaper.img}')"></div>
      <div class="hamster-preview__fog"></div>
      <div class="hamster-preview__ground"></div>
      <div class="hamster-preview__stage">
        <div class="hamster-preview__shadow"></div>
        <img class="hamster-preview__sprite" src="${hamsterSprite}" alt="Хомяк" />
        <div class="hamster-preview__outfit">
          ${head !== 'none' ? `<div class="appearance-layer appearance-layer--headwear appearance-layer--${head}"></div>` : ''}
          ${glasses !== 'none' ? `<div class="appearance-layer appearance-layer--glasses appearance-layer--${glasses}"></div>` : ''}
          ${mask !== 'none' ? `<div class="appearance-layer appearance-layer--mask appearance-layer--${mask}"></div>` : ''}
          ${body !== 'none' ? `<div class="appearance-layer appearance-layer--body appearance-layer--${body}"></div>` : ''}
          ${shoes !== 'none' ? `<div class="appearance-layer appearance-layer--shoes appearance-layer--${shoes}"></div>` : ''}
          ${held !== 'none' ? `<div class="appearance-layer appearance-layer--heldItem appearance-layer--${held}"></div>` : ''}
        </div>
      </div>
    </div>
  `;
}

function formatSeenAt(value) {
  if (!value) return 'Неизвестно';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Неизвестно';
  return date.toLocaleString('ru-RU');
}


function countUnlockedAchievements(state) {
  const bestBattleDamage = Math.max(0, Number(state?.bossBattleDamageBest) || 0);
  const battleDamageUnlocked = BATTLE_DAMAGE_ACHIEVEMENTS.filter((threshold) => bestBattleDamage >= threshold).length;

  const bosses = Array.isArray(state?.bosses) ? state.bosses : [];
  const speedTargets = [
    { bossId: 'rat', threshold: 3600 },
    { bossId: 'lizard', threshold: 3600 },
    { bossId: 'swagusinitsa', threshold: 3600 },
    { bossId: 'sand_lizard', threshold: 3600 },
    { bossId: 'sand_snake', threshold: 3600 },
    { bossId: 'cave_centipede', threshold: 3600 },
    { bossId: 'cave_bird', threshold: 3600 },
    { bossId: 'cave_spider', threshold: 3600 },
    { bossId: 'honey_badger', threshold: 3600 },
  ];
  const speedUnlocked = speedTargets.reduce((sum, target) => {
    const boss = bosses.find((item) => item && item.id === target.bossId);
    const bestClearSeconds = Math.max(0, Number(boss?.bestClearSeconds) || 0);
    return sum + (bestClearSeconds > 0 && bestClearSeconds <= target.threshold ? 1 : 0);
  }, 0);

  const bossPassUnlocked = bosses.reduce((sum, boss) => {
    const killsTotal = Math.max(0, Number(boss?.killsTotal) || 0);
    return sum + BOSS_PASS_ACHIEVEMENT_THRESHOLDS.filter((threshold) => killsTotal >= threshold).length;
  }, 0);

  const talentPointsSpent = Math.max(0, Number(state?.player?.talentPointsSpent) || 0);
  const talentSpentUnlocked = TALENT_POINTS_SPENT_ACHIEVEMENT_THRESHOLDS.filter((threshold) => talentPointsSpent >= threshold).length;

  const totals = state?.economyTotals || {};
  const economyUnlocked = ECONOMY_ACHIEVEMENTS.reduce((sum, resource) => {
    const total = Math.max(0, Number(totals?.[resource.key]) || 0);
    const unlocked = ECONOMY_ACHIEVEMENT_THRESHOLDS.filter((threshold) => total >= threshold).length;
    return sum + unlocked;
  }, 0);

  return battleDamageUnlocked + speedUnlocked + bossPassUnlocked + talentSpentUnlocked + economyUnlocked;
}

function renderProfileSummary(profile) {
  const state = profile?.state || {};
  const player = state.player || {};
  const onlineText = profile?.online ? 'Онлайн' : `Был(а) ${formatSeenAt(profile?.lastSeenAt)}`;
  const bossDamageDay = Math.max(0, Number(state.bossDamageDay) || 0);
  const bossDamageWeek = Math.max(0, Number(state.bossDamageWeek) || 0);
  const bossDamageMonth = Math.max(0, Number(state.bossDamageMonth) || 0);
  const bossDamageAllTime = Math.max(0, Number(state.bossDamageAllTime) || 0);
  const bosses = Array.isArray(state.bosses) ? state.bosses : [];
  const bossTotal = bosses.reduce((sum, boss) => sum + Math.max(0, Number(boss?.killsTotal) || 0), 0);
  const adventureLoops = Math.max(0, Number(state.locationPasses) || 0);

  const actionButtons = profile?.isSelf
    ? ''
    : `
      <div class="profile-actions">
        <button type="button" class="ghost" data-profile-view-hamster="${profile?.login || ''}">Посмотреть хомяка</button>
        ${profile?.isFriend
          ? `<button type="button" class="ghost" data-profile-remove-friend="${profile?.login || ''}">Удалить из друзей</button>`
          : `<button type="button" class="primary" data-profile-add-friend="${profile?.login || ''}" onclick='void window.humsterAddFriend(${jsStringLiteral(profile?.login || '')})'>Добавить в друзья</button>`}
      </div>
    `;

  const totalAchievements = countUnlockedAchievements(state);
  const stats = [
    { label: 'Уровень хомяка', value: String(player.level || 1) },
    { label: 'Получено достижений', value: formatAchievementNumber(totalAchievements) },
    { label: 'Урон за день', value: formatAchievementNumber(bossDamageDay) },
    { label: 'Урон за неделю', value: formatAchievementNumber(bossDamageWeek) },
    { label: 'Урон за месяц', value: formatAchievementNumber(bossDamageMonth) },
    { label: 'Урон за всё время', value: formatAchievementNumber(bossDamageAllTime) },
  ];

  const bossRows = bosses.length
    ? bosses.map((boss, index) => `
        <div class="profile-row">
          <strong>${boss?.name || `Босс ${index + 1}`}</strong>
          <span>${formatAchievementNumber(Math.max(0, Number(boss?.killsTotal) || 0))} раз</span>
        </div>
      `).join('')
    : '<div class="profile-note">Список боссов пока пуст.</div>';

  return `
    <div class="social-profile social-profile--compact">
      <div class="profile-section social-profile__header">
        <div class="profile-section__head">
          <strong>${profile?.isSelf ? 'Твой профиль' : 'Профиль игрока'}</strong>
          <span>${onlineText}</span>
        </div>
        <div class="social-profile__summary">
          <div class="profile-card">
            <span>Уровень</span>
            <strong>${String(player.level || 1)}</strong>
          </div>
        </div>
        ${actionButtons}
      </div>

      <div class="profile-section">
        <div class="profile-section__head">
          <strong>Статистика</strong>
          <span>Показатели хомяка</span>
        </div>
        <div class="social-profile__cards social-profile__cards--compact">
          ${stats.map((card) => `
            <div class="profile-card">
              <span>${card.label}</span>
              <strong>${card.value}</strong>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="profile-section">
        <div class="profile-section__head">
          <strong>Победы над боссами</strong>
          <span>${formatAchievementNumber(bossTotal)} всего</span>
        </div>
        <div class="profile-list">
          ${bossRows}
        </div>
      </div>

      <div class="profile-section">
        <div class="profile-section__head">
          <strong>Круги карты</strong>
          <span>${formatAchievementNumber(adventureLoops)} всего</span>
        </div>
        <div class="profile-list">
          <div class="profile-row">
            <strong>Полные проходы от 1 до 5</strong>
            <span>${formatAchievementNumber(adventureLoops)} раз</span>
          </div>
        </div>
      </div>

      <div class="social-note">
        ${profile?.isSelf ? 'Это твой профиль.' : 'Профиль игрока открыт для просмотра.'}
      </div>
    </div>
  `;
}


function renderHamsterPreview(profile) {
  const state = profile?.state || {};
  const player = state.player || {};
  const appearance = player.appearance || {};
  const wallpaper = getWallpaperAsset(appearance.background || player.wallpaper || 'wallpaper_day');
  const hamsterSprite = getHamsterSpriteAsset(appearance.color || 'default');
  const outfit = `
    ${appearance.headwear && appearance.headwear !== 'none' ? `<div class="appearance-layer appearance-layer--headwear appearance-layer--${appearance.headwear}"></div>` : ''}
    ${appearance.glasses && appearance.glasses !== 'none' ? `<div class="appearance-layer appearance-layer--glasses appearance-layer--${appearance.glasses}"></div>` : ''}
    ${appearance.mask && appearance.mask !== 'none' ? `<div class="appearance-layer appearance-layer--mask appearance-layer--${appearance.mask}"></div>` : ''}
    ${appearance.body && appearance.body !== 'none' ? `<div class="appearance-layer appearance-layer--body appearance-layer--${appearance.body}"></div>` : ''}
    ${appearance.shoes && appearance.shoes !== 'none' ? `<div class="appearance-layer appearance-layer--shoes appearance-layer--${appearance.shoes}"></div>` : ''}
    ${appearance.heldItem && appearance.heldItem !== 'none' ? `<div class="appearance-layer appearance-layer--heldItem appearance-layer--${appearance.heldItem}"></div>` : ''}
  `;
  return `
    <div class="hamster-preview">
      <div class="hamster-preview__scene" style="background-image: url('${wallpaper.img}')">
        <div class="scene-fog"></div>
        <div class="scene-ground"></div>
        <div class="hamster-stage hamster-stage--preview">
          <div class="ground-shadow"></div>
          <img src="${hamsterSprite}" alt="Хомяк" />
          <div class="hamster-preview__outfit">${outfit}</div>
        </div>
      </div>
      <div class="hamster-preview__meta">
        <strong>${profile?.login || 'Хомяк'}</strong>
        <span>${wallpaper.name}</span>
      </div>
    </div>
  `;
}

function ensureHamsterPreviewModal() {
  if (document.getElementById('hamster-preview-modal')) return;
  document.body.insertAdjacentHTML('beforeend', `
    <div id="hamster-preview-modal" class="hamster-preview-modal" hidden>
      <div class="hamster-preview-modal__backdrop" data-hamster-preview-close></div>
      <div class="hamster-preview-modal__dialog" role="dialog" aria-modal="true" aria-labelledby="hamster-preview-title">
        <div class="hamster-preview-modal__head">
          <div>
            <div class="eyebrow">Просмотр хомяка</div>
            <h3 id="hamster-preview-title">Хомяк друга</h3>
          </div>
          <button type="button" class="ghost" data-hamster-preview-close>Закрыть</button>
        </div>
        <div id="hamster-preview-modal-body" class="hamster-preview-modal__body"></div>
      </div>
    </div>
  `);
}

function renderHamsterPreviewModal(profile) {
  const modal = document.getElementById('hamster-preview-modal');
  if (!modal) return;
  const body = document.getElementById('hamster-preview-modal-body');
  if (body) {
    body.innerHTML = profile ? renderHamsterPreview(profile) : '<div class="social-note">Хомяк не найден.</div>';
  }
  document.querySelectorAll('[data-hamster-preview-close]').forEach((btn) => {
    btn.onclick = closeHamsterPreviewModal;
  });
}

async function openHamsterPreviewModal(login = '') {
  ensureHamsterPreviewModal();
  const modal = document.getElementById('hamster-preview-modal');
  if (modal) modal.hidden = false;
  const target = normalizeLogin(login);
  if (!target) {
    renderHamsterPreviewModal(null);
    return;
  }
  try {
    const res = await fetch(apiUrl(`/social/profile?login=${encodeURIComponent(target)}`), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.profile) {
      renderHamsterPreviewModal(normalizeSocialProfile(data.profile));
      return;
    }
  } catch (err) {}
  renderHamsterPreviewModal(null);
}

function closeHamsterPreviewModal() {
  const modal = document.getElementById('hamster-preview-modal');
  if (modal) modal.hidden = true;
  if (previewReturnToProfile && profileModalProfile) {
    const profileModal = document.getElementById('profile-modal');
    if (profileModal) profileModal.hidden = false;
    renderProfileModal(profileModalProfile);
  }
  previewReturnToProfile = false;
}

function renderFriendRow(friend, mode = 'friend') {
  const state = friend?.state || {};
  const player = state.player || {};
  const onlineText = friend?.online ? 'Онлайн' : `Был(а) ${formatSeenAt(friend?.lastSeenAt)}`;
  const name = friend?.login || 'игрок';
  const bodyActions = mode === 'request'
    ? `
      <div class="social-row__actions">
        <button type="button" class="primary" data-friend-accept="${name}">Принять</button>
        <button type="button" class="ghost" data-friend-decline="${name}">Отклонить</button>
      </div>
    `
    : `
      <div class="social-row__actions">
        <button type="button" class="ghost" data-friend-open="${name}">Открыть профиль</button>
        <button type="button" class="ghost" data-friend-preview="${name}">Посмотреть хомяка</button>
        <button type="button" class="ghost" data-friend-remove="${name}">Удалить</button>
      </div>
    `;
  const avatar = '';

  return `
    <article class="social-row${mode === 'request' ? ' social-row--request' : ''}">
      ${avatar}
      <div class="social-row__body">
        <div class="social-row__head">
          <button type="button" class="social-row__name" data-friend-open="${name}">${name}</button>
          <span class="social-row__status">${onlineText}</span>
        </div>
        <div class="social-row__meta">${player.name || 'Хомяк'} • ур. ${Math.max(1, Number(player.level) || 1)}</div>
        ${bodyActions}
      </div>
    </article>
  `;
}

function renderFriendsRequests(profile) {
  const requests = Array.isArray(profile?.requests) ? profile.requests : [];
  if (!requests.length) {
    return '<div class="social-note">Заявок в друзья пока нет.</div>';
  }
  return `<div class="social-list">${requests.map((friend) => renderFriendRow(friend, 'request')).join('')}</div>`;
}

function renderFriendsList(profile) {
  const friends = Array.isArray(profile?.friends) ? profile.friends : [];
  if (!friends.length) {
    return '<div class="social-note">Пока друзей нет. Введи логин и отправь заявку.</div>';
  }
  return `<div class="social-list">${friends.map((friend) => renderFriendRow(friend, 'friend')).join('')}</div>`;
}

function bindProfileModalEvents() {
  document.querySelectorAll('[data-profile-close]').forEach((btn) => {
    btn.onclick = closeProfileModal;
  });
  document.querySelectorAll('[data-profile-remove-friend]').forEach((btn) => {
    btn.onclick = async () => {
      const login = btn.getAttribute('data-profile-remove-friend') || '';
      if (login) {
        await mutateFriendRequest('remove', login);
      }
    };
  });
  document.querySelectorAll('[data-profile-view-hamster]').forEach((btn) => {
    btn.onclick = () => {
      const login = btn.getAttribute('data-profile-view-hamster') || '';
      if (!login) return;
      const profileModal = document.getElementById('profile-modal');
      previewReturnToProfile = Boolean(profileModal && !profileModal.hidden && profileModalProfile);
      if (profileModal && previewReturnToProfile) {
        profileModal.hidden = true;
      }
      openHamsterPreviewModal(login);
    };
  });
}

function renderProfileModal(profile) {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const body = document.getElementById('profile-modal-body');
  const title = document.getElementById('profile-title');
  const error = document.getElementById('profile-modal-error');

  if (title) {
    title.textContent = profile?.isSelf ? 'Профиль хомяка' : 'Профиль игрока';
  }
  if (error) {
    error.textContent = profileModalError || '';
  }
  if (body) {
    if (profileModalLoading) {
      body.innerHTML = '<div class="social-note">Загрузка профиля...</div>';
    } else if (profile) {
      body.innerHTML = renderProfileSummary(profile);
    } else {
      body.innerHTML = '<div class="social-note">Профиль не найден.</div>';
    }
  }
  bindProfileModalEvents();
}

async function loadProfileModal(login) {
  const target = normalizeLogin(login || currentUserLogin || currentState?.player?.name || '');
  if (!target) {
    profileModalProfile = null;
    profileModalError = 'Сначала создай аккаунт или войди в игру';
    profileModalLoading = false;
    renderProfileModal(null);
    return;
  }
  profileModalTarget = target;
  const selfLogin = normalizeLogin(currentUserLogin || currentState?.player?.name || '');
  if (selfLogin && selfLogin === target && currentState) {
    profileModalProfile = normalizeSocialProfile({
      login: target,
      state: currentState,
      online: true,
      isSelf: true,
      friends: friendsModalProfile?.friends || [],
      requests: friendsModalProfile?.requests || [],
    });
    profileModalLoading = false;
    profileModalError = '';
    renderProfileModal(profileModalProfile);
    return;
  }
  profileModalLoading = true;
  profileModalError = '';
  renderProfileModal(profileModalProfile);
  try {
    const res = await fetch(apiUrl(`/social/profile?login=${encodeURIComponent(target)}`), {
      method: 'GET',
      headers: authHeaders(),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok && data.profile) {
      profileModalProfile = normalizeSocialProfile(data.profile);
      profileModalLoading = false;
      profileModalError = '';
      renderProfileModal(profileModalProfile);
      return;
    }
    profileModalError = data && data.error ? data.error : 'Не удалось загрузить профиль';
    profileModalProfile = null;
  } catch (error) {
    profileModalError = 'Не удалось загрузить профиль';
    profileModalProfile = null;
  }
  profileModalLoading = false;
  renderProfileModal(profileModalProfile);
}

function normalizeSocialProfile(profile) {
  const state = normalizeState(profile?.state || DEFAULT_STATE);
  const friends = Array.isArray(profile?.friends) ? profile.friends.map((friend) => ({
    ...friend,
    state: normalizeState(friend?.state || DEFAULT_STATE),
  })) : [];
  const requests = Array.isArray(profile?.requests) ? profile.requests.map((friend) => ({
    ...friend,
    state: normalizeState(friend?.state || DEFAULT_STATE),
  })) : [];
  return {
    ...profile,
    state,
    friends,
    requests,
    isSelf: Boolean(profile?.isSelf),
    isFriend: Boolean(profile?.isFriend),
    online: Boolean(profile?.online),
  };
}

async function openProfileModal(login = currentUserLogin || currentState?.player?.name || '') {
  ensureProfileModal();
  const modal = document.getElementById('profile-modal');
  if (modal) modal.hidden = false;
  if (!isAuthenticated) {
    profileModalTarget = '';
    profileModalProfile = null;
    profileModalLoading = false;
    profileModalError = 'Сначала войди в игру, чтобы пользоваться друзьями';
    renderProfileModal(null);
    return;
  }
  await loadProfileModal(login);
}