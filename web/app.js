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

const API_BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl) ? window.APP_CONFIG.apiBaseUrl : '/api';
const SESSION_KEY = 'humster_session_id';
const AUTH_TOKEN_KEY = 'humster_auth_token';
const VIEW_KEY = 'humster_view';

function getSavedView() {
  const saved = localStorage.getItem(VIEW_KEY);
  return ['main', 'battle', 'adventure', 'edit'].includes(saved) ? saved : 'main';
}

function setView(nextView) {
  view = ['main', 'battle', 'adventure', 'edit'].includes(nextView) ? nextView : 'main';
  localStorage.setItem(VIEW_KEY, view);
}

function restoreViewFromState(state) {
  if (state && state.activeBossId && bossById(state, state.activeBossId)) {
    setView('battle');
  }
}

const ADVENTURE_DEFS = [
  { id: 'stage5', label: 'Бежать по полю', image: '/assets/adventure/stage5.png', x: 33.5, y: 24.8, energyCost: 1, requiredPasses: 4 },
  { id: 'stage4', label: 'Собирать пшеницу', image: '/assets/adventure/stage4.png', x: 67.6, y: 26.8, energyCost: 2, requiredPasses: 4 },
  { id: 'stage3', label: 'Собирать орешки для белочки', image: '/assets/adventure/stage3.png', x: 86.1, y: 53.3, energyCost: 3, requiredPasses: 5 },
  { id: 'stage2', label: 'Делать домик', image: '/assets/adventure/stage2.png', x: 52.3, y: 80.1, energyCost: 3, requiredPasses: 6 },
  { id: 'stage1', label: 'Строить мост через ручей', image: '/assets/adventure/stage1.png', x: 26.7, y: 50.8, energyCost: 4, requiredPasses: 6 },
];

const CATALOG = {
  wallpapers: [
    { id: 'wallpaper_day', name: 'Летний сад', slot: 'wallpaper', img: '/assets/wallpapers/field_day.png' },
    { id: 'wallpaper_sunset', name: 'Закатное поле', slot: 'wallpaper', img: '/assets/wallpapers/field_sunset.png' },
    { id: 'wallpaper_night', name: 'Ночное поле', slot: 'wallpaper', img: '/assets/wallpapers/field_night.png' },
  ],
  bosses: [
    { id: 'rat', name: 'Крыса', img: '/assets/bosses/rat.png' },
    { id: 'lizard', name: 'Ящерица', img: '/assets/bosses/lizard.png' },
    { id: 'sand_lizard', name: 'Песчаная ящерица', img: '/assets/bosses/sand_lizard.png' },
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
    { id: 'wallpaper_day', name: 'Летний сад', img: '/assets/wallpapers/field_day.png' },
  ],
  color: [
    { id: 'default', name: 'Базовый', img: '/assets/hamster/base.png' },
    { id: 'color1', name: 'Зеленый', img: '/assets/hamster/color1.png' },
    { id: 'color2', name: 'Серый', img: '/assets/hamster/color2.png' },
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
  { id: 'belly_punch', label: 'Удар пузиком', damage: 5, costWheat: 0 },
  { id: 'scratch', label: 'Царапанье', damage: 20, costWheat: 0 },
  { id: 'rush', label: 'Удар с разбега', damage: 15, costWheat: 0 },
  { id: 'bite', label: 'Укус', damage: 30, costWheat: 0 },
  { id: 'iron_claw', label: 'Удар железным когтем', damage: 100, costWheat: 2 },
  { id: 'poison_bite', label: 'Ядовитый укус', damage: 300, costWheat: 6 },
  { id: 'eye_lasers', label: 'Лазеры из глаз', damage: 700, costWheat: 13 },
];

const BOSS_KILL_LIMIT = 8;

const BOSS_BLUEPRINTS = {
  rat: { name: 'Крыса', hp: 70, attack: 4, xp: 10, reward: { seeds: 20, wheat: 2, carrot: 1, cucumber: 0 } },
  lizard: { name: 'Ящерица', hp: 150, attack: 8, xp: 20, reward: { seeds: 50, wheat: 3, carrot: 0, cucumber: 1 } },
  sand_lizard: { name: 'Песчаная ящерица', hp: 600, attack: 16, xp: 50, reward: { seeds: 200, wheat: 0, carrot: 3, cucumber: 1 } },
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
  adventure: ADVENTURE_DEFS.map((node) => ({
    id: node.id,
    name: node.label,
    energyCost: node.energyCost,
    requiredPasses: node.requiredPasses,
    progress: 0,
    completed: false,
  })),
  activeAdventureId: 'stage5',
  log: ['Добро пожаловать в поле хомяков.'],
  updatedAt: new Date().toISOString(),
  lastEnergyRegenAt: new Date().toISOString(),
};

let currentState = structuredClone(DEFAULT_STATE);
let view = getSavedView();
let editCategory = 'background';
let pendingAdventureShakeId = null;
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
  next.player.energy = clampNumber(next.player.energy ?? DEFAULT_STATE.player.energy, 0, 40);
  next.player.maxEnergy = 40;
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
  normalizeDamageStats(next);
  normalizeBossTimers(next);
  refreshBossKillLimit(next);

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
  const maxEnergy = 40;
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
  const energy = clampNumber(player.energy, 0, 40);
  const maxEnergy = 40;
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

function bossAttackCooldownRemaining(boss, attackId) {
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
  return '/assets/hamster/base.png';
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

let profileModalTarget = false;

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
        <div id="profile-modal-body" class="profile-modal__body"></div>
      </div>
    </div>
  `);
}

function renderProfileModal(state) {
  const modal = document.getElementById('profile-modal');
  if (!modal) return;
  const body = document.getElementById('profile-modal-body');
  if (!body) return;
  const player = state?.player || {};
  const bosses = state?.bosses || [];
  const bossRows = bosses.map((boss) => `
    <div class="profile-row">
      <span>${boss.name || boss.id}</span>
      <strong>${Math.max(0, Number(boss.killsTotal) || 0)}</strong>
    </div>
  `).join('');
  body.innerHTML = `
    <div class="profile-grid">
      <div class="profile-card">
        <span>Уровень</span>
        <strong>${player.level || 1}</strong>
      </div>
      <div class="profile-card">
        <span>Урон по боссам за день</span>
        <strong>${Math.max(0, Number(state?.bossDamageDay) || 0)}</strong>
      </div>
      <div class="profile-card">
        <span>Урон по боссам за неделю</span>
        <strong>${Math.max(0, Number(state?.bossDamageWeek) || 0)}</strong>
      </div>
      <div class="profile-card">
        <span>Урон по боссам за месяц</span>
        <strong>${Math.max(0, Number(state?.bossDamageMonth) || 0)}</strong>
      </div>
      <div class="profile-card profile-card--wide">
        <span>Урон по боссам за всё время</span>
        <strong>${Math.max(0, Number(state?.bossDamageAllTime) || 0)}</strong>
      </div>
      <div class="profile-card">
        <span>Проходок локации</span>
        <strong>${Math.max(0, Number(state?.locationPasses) || 0)}</strong>
      </div>
    </div>
    <div class="profile-section">
      <div class="profile-section__head">
        <h4>Прохождения боссов</h4>
        <span>Счётчик побед</span>
      </div>
      <div class="profile-list">
        ${bossRows}
      </div>
    </div>
    <div class="profile-note">Счётчики обновляются после каждого удара и победы над боссом.</div>
  `;
}

function openProfileModal() {
  ensureProfileModal();
  profileModalTarget = true;
  const modal = document.getElementById('profile-modal');
  if (modal) modal.hidden = false;
  renderProfileModal(currentState);
}

function closeProfileModal() {
  profileModalTarget = false;
  const modal = document.getElementById('profile-modal');
  if (modal) modal.hidden = true;
}

function renderAccessoryMarkup(slot, value) {
  if (!value || value === 'none') return '';
  const item = getAppearanceOption(slot, value);
  if (!item) return '';
  const label = item.name || value;
  return `<div class="appearance-layer appearance-layer--${slot} appearance-layer--${value}">${label}</div>`;
}

function renderResourceStrip(state) {
  const p = state.player;
  const currencies = p.currency || {};
  const xpNeed = xpForNextLevel(p.level || 1);
  const xpLeft = Math.max(0, xpNeed - (p.xp || 0));
  const chips = [
    { label: isAuthenticated ? (currentUserLogin || 'Аккаунт') : 'Гость', value: `${p.name} • ур. ${p.level}`, accent: true },
    { label: 'Опыт', value: `${p.xp || 0}/${xpNeed}` },
    { label: 'До след. уровня', value: `${xpLeft}` },
    { label: 'Семечки', value: `${currencies.seeds || 0}` },
    { label: 'Пшеница', value: `${currencies.wheat || 0}` },
    { label: 'Морковь', value: `${currencies.carrot || 0}` },
    { label: 'Огурцы', value: `${currencies.cucumber || 0}` },
    { label: 'Яблоки', value: `${currencies.apple || 0}` },
    { label: 'Кормик', value: `${currencies.kormik || 0}` },
    { label: 'Энергия', value: `${p.energy || 0}/${p.maxEnergy || 40}`, sub: getEnergyCountdown(state) },
  ];

  $('#resource-strip').innerHTML = chips.map((chip) => `
    <div class="hud-chip ${chip.accent ? 'hud-chip--accent' : ''}">
      <span>${chip.label}</span>
      <strong>${chip.value}</strong>
      ${chip.sub ? `<small class="hud-chip__sub">${chip.sub}</small>` : ''}
    </div>
  `).join('');
}

function updateScene(state) {
  const appearance = state.player.appearance || {};
  const wallpaperId = appearance.background || state.player.wallpaper || state.player.equipped?.wallpaper || 'wallpaper_day';
  const wallpaper = getWallpaperAsset(wallpaperId);

  $('#scene-wallpaper').style.backgroundImage = `url("${wallpaper.img}")`;
  $('#scene-meta').textContent = wallpaper.name;

  const hamsterSprite = getHamsterSpriteAsset(appearance.color || 'default');
  const spriteLayer = $('#hamster-sprite');
  if (spriteLayer) {
    spriteLayer.src = hamsterSprite;
  }
  const colorLayer = $('#hamster-color-layer');
  if (colorLayer) {
    colorLayer.hidden = true;
    colorLayer.style.backgroundImage = 'none';
    colorLayer.style.backgroundColor = 'transparent';
    colorLayer.style.webkitMaskImage = 'none';
    colorLayer.style.maskImage = 'none';
  }

  const body = appearance.body || 'none';
  const head = appearance.headwear || 'none';
  const glasses = appearance.glasses || 'none';
  const mask = appearance.mask || 'none';
  const shoes = appearance.shoes || 'none';
  const held = appearance.heldItem || 'none';

  $('#hamster-outfit').innerHTML = `
    ${head !== 'none' ? `<div class="appearance-layer appearance-layer--headwear appearance-layer--${head}"></div>` : ''}
    ${glasses !== 'none' ? `<div class="appearance-layer appearance-layer--glasses appearance-layer--${glasses}"></div>` : ''}
    ${mask !== 'none' ? `<div class="appearance-layer appearance-layer--mask appearance-layer--${mask}"></div>` : ''}
    ${body !== 'none' ? `<div class="appearance-layer appearance-layer--body appearance-layer--${body}"></div>` : ''}
    ${shoes !== 'none' ? `<div class="appearance-layer appearance-layer--shoes appearance-layer--${shoes}"></div>` : ''}
    ${held !== 'none' ? `<div class="appearance-layer appearance-layer--heldItem appearance-layer--${held}"></div>` : ''}
  `;
}

function skinBonusDamage(state, attackType) {
  const ownedColor1 = Number(state?.player?.inventory?.color1 || 0) > 0;
  const ownedColor2 = Number(state?.player?.inventory?.color2 || 0) > 0;
  if (attackType === 'belly_punch' || attackType === 'iron_claw') {
    return ownedColor2 ? 5 : 0;
  }
  if (attackType === 'poison_bite') {
    return ownedColor1 ? 20 : 0;
  }
  return 0;
}

function attackDamage(state, attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  return attack ? attack.damage + skinBonusDamage(state, attackType) : 0;
}

function attackLabel(attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  return attack ? attack.label : 'удар';
}

function attackCostWheat(attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  return attack ? (attack.costWheat || 0) : 0;
}

function attackOwnedCount(state, attackType) {
  return Number(state?.player?.inventory?.[attackType] || 0);
}

function hasAttackCharge(state, attackType) {
  const cost = attackCostWheat(attackType);
  return cost <= 0 || attackOwnedCount(state, attackType) > 0;
}

function applyLocalAction(action, payload = {}) {
  const state = currentState;
  const bossIndex = state.bosses.findIndex((boss) => boss.id === state.activeBossId);
  const boss = bossIndex >= 0 ? state.bosses[bossIndex] : null;

  switch (action) {
    case 'select_boss': {
      const bossId = payload.bossId || '';
      if (state.activeBossId && state.activeBossId !== bossId) {
        const activeBoss = bossById(state, state.activeBossId);
        if (activeBoss && !activeBoss.defeated && (!activeBoss.battleEndsAt || toMillis(activeBoss.battleEndsAt) > Date.now())) {
          return;
        }
      }
      state.activeBossId = bossId;
      const active = bossById(state, bossId);
      if (active) {
        const remaining = bossDailyRemaining(active);
        if (active.defeated) {
          if (remaining <= 0) return;
          const now = Date.now();
          active.defeated = false;
          active.hp = active.maxHp;
          active.battleStartedAt = new Date(now).toISOString();
          active.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
          active.attackCooldowns = {};
        } else if (!active.battleStartedAt || !active.battleEndsAt) {
          const now = Date.now();
          active.battleStartedAt = new Date(now).toISOString();
          active.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
        }
      }
      return;
    }
    case 'finish_battle': {
      const activeBoss = bossById(state, state.activeBossId);
      if (!activeBoss) return;
      const now = Date.now();
      if (activeBoss.defeated || (activeBoss.battleEndsAt && toMillis(activeBoss.battleEndsAt) <= now)) {
        state.activeBossId = '';
        return;
      }
      if ((state.player.currency?.kormik || 0) < 1) return;
      state.player.currency.kormik -= 1;
      activeBoss.hp = activeBoss.maxHp;
      activeBoss.defeated = false;
      activeBoss.battleStartedAt = '';
      activeBoss.battleEndsAt = '';
      activeBoss.attackCooldowns = {};
      state.activeBossId = '';
      return;
    }
    case 'buy_attack': {
      const cost = attackCostWheat(payload.attackType);
      const label = attackLabel(payload.attackType);
      if (cost <= 0) return;
      if (state.player.currency.wheat < cost) {
        return;
      }
      state.player.currency.wheat -= cost;
      state.player.inventory[payload.attackType] = attackOwnedCount(state, payload.attackType) + 1;
      appendLog(state, `Куплена атака ${label} за ${cost} пшеницы.`);
      return;
    }
    case 'attack_boss': {
      if (!boss) return;
      const dmg = attackDamage(state, payload.attackType);
      const cost = attackCostWheat(payload.attackType);
      const now = Date.now();
      if (cost > 0 && attackOwnedCount(state, payload.attackType) <= 0) {
        return;
      }
      if (boss.defeated) {
        if (bossDailyRemaining(boss) <= 0) return;
        boss.defeated = false;
        boss.hp = boss.maxHp;
        boss.battleStartedAt = new Date(now).toISOString();
        boss.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
        boss.attackCooldowns = {};
      }
      if (!boss.battleEndsAt) {
        boss.battleStartedAt = new Date(now).toISOString();
        boss.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
      }
      if (boss.battleEndsAt && toMillis(boss.battleEndsAt) < now) {
        boss.hp = boss.maxHp;
        boss.defeated = false;
        boss.battleStartedAt = '';
        boss.battleEndsAt = '';
        boss.attackCooldowns = {};
        state.activeBossId = '';
        return;
      }
      boss.attackCooldowns = boss.attackCooldowns || {};
      const cooldownUntil = toMillis(boss.attackCooldowns[payload.attackType]);
      if (cooldownUntil && now < cooldownUntil) return;
      const killsToday = boss.killsDay === bossKillDayKey() ? (boss.killsToday || 0) : 0;
      if (boss.hp - dmg <= 0 && killsToday >= BOSS_KILL_LIMIT) return;
      boss.hp = Math.max(0, boss.hp - dmg);
      if (cost > 0) {
        state.player.inventory[payload.attackType] = Math.max(0, attackOwnedCount(state, payload.attackType) - 1);
      }
      boss.attackCooldowns[payload.attackType] = new Date(now + (6 * 60 * 60 * 1000)).toISOString();
      if (boss.hp === 0) {
        boss.defeated = true;
        boss.battleStartedAt = '';
        boss.battleEndsAt = '';
        boss.attackCooldowns = {};
        boss.killsToday = clampNumber((boss.killsToday || 0) + 1, 0, BOSS_KILL_LIMIT);
        boss.killsDay = bossKillDayKey();
        for (const [cur, amt] of Object.entries(boss.reward || {})) {
          state.player.currency[cur] = (state.player.currency[cur] || 0) + amt;
        }
        state.player.xp += boss.xp || 0;
        maybeGrantBossCosmeticDrop(state, boss);
        recalcLevel(state);
        state.activeBossId = '';
      }
      return;
    }
    case 'select_adventure': {
      const nodeId = payload.nodeId;
      if (nodeId && currentState.adventure.some((node) => node.id === nodeId)) {
        const idx = currentState.adventure.findIndex((node) => node.id === nodeId);
        if (!isAdventureLocked(currentState, idx)) {
          currentState.activeAdventureId = nodeId;
        }
      }
      return;
    }
    case 'adventure_step': {
      const nodeId = payload.nodeId;
      const idx = currentState.adventure.findIndex((node) => node.id === nodeId);
      if (idx < 0) return;
      const node = currentState.adventure[idx];
      if (isAdventureLocked(currentState, idx) || node.completed || currentState.player.energy < node.energyCost) return;
      currentState.player.energy -= node.energyCost;
      currentState.adventure[idx].progress += 1;
      const reward = ADVENTURE_REWARDS[idx] || { xp: 0, seeds: 0 };
      currentState.player.xp += reward.xp || 0;
      currentState.player.currency.seeds = (currentState.player.currency.seeds || 0) + (reward.seeds || 0);
      recalcLevel(currentState);
      if (currentState.adventure[idx].progress >= node.requiredPasses) {
        currentState.adventure[idx].completed = true;
        const next = currentState.adventure.find((item) => !item.completed);
        currentState.activeAdventureId = next ? next.id : currentState.activeAdventureId;
      }
      return;
    }
    case 'set_appearance': {
      const slot = payload.slot;
      const value = payload.value;
      if (!slot || !value) return;
      if (slot === 'color' && value !== 'default' && (currentState.player.inventory?.[value] || 0) <= 0) {
        return;
      }
      currentState.player.appearance = {
        ...(currentState.player.appearance || {}),
        [slot]: value,
      };
      if (slot === 'background') {
        currentState.player.wallpaper = value;
        currentState.player.appearance.background = value;
      }
      return;
    }
    case 'new_run': {
      currentState = normalizeState(DEFAULT_STATE);
      return;
    }
    default:
      return;
  }
}

async function syncAction(action, payload = {}) {
  const response = await api('/action', { action, ...payload });
  if (response.data && response.data.state) {
    currentState = normalizeState(response.data.state);
  } else if (response.status === 401) {
    setAuthToken('');
    isAuthenticated = false;
    currentUserLogin = '';
  } else {
    applyLocalAction(action, payload);
  }
  render();
  return response;
}

function renderBossSelection() {
  $('#battle-screen-title').textContent = 'Выбор босса';
  $('#battle-screen-subtitle').textContent = 'Нажми на босса, чтобы начать бой или пройти его ещё раз, если дневной лимит ещё не исчерпан.';
  const body = $('#battle-screen-body');
  body.innerHTML = `
    <div class="modal-note">Выбери босса, чтобы открыть бой. У каждого босса свой дневной лимит: ${BOSS_KILL_LIMIT} побед в день.</div>
    <div class="boss-grid">
      ${(currentState.bosses || []).map((boss) => {
        const cat = CATALOG.bosses.find((item) => item.id === boss.id) || boss;
        const rewardText = bossRewardText(boss);
        const hpText = `${boss.maxHp || boss.hp} HP`;
        const battleTimer = !boss.defeated && boss.battleEndsAt ? bossBattleCountdown(boss) : '';
        const remainingKills = bossDailyRemaining(boss);
        return `
          <article class="boss-card ${boss.defeated ? 'is-defeated' : ''}">
            <img class="boss-card__img" src="${cat.img}" alt="${boss.name}" />
            <div class="boss-card__body">
              <div class="boss-card__title">
                <strong>${boss.name}</strong>
                <span>${hpText}</span>
              </div>
              <div class="boss-card__reward">Награда: ${rewardText}</div>
              <div class="boss-card__xp">Опыт: ${boss.xp || 0}</div>
              <div class="boss-card__limit">Осталось сегодня: ${remainingKills}/${BOSS_KILL_LIMIT}</div>
              ${battleTimer ? `<div class="boss-card__timer">До конца битвы: ${battleTimer}</div>` : ''}
              ${currentState.activeBossId && currentState.activeBossId !== boss.id ? `<div class="boss-card__lock">Сначала заверши текущую битву с ${bossById(currentState, currentState.activeBossId)?.name || 'другим боссом'}.</div>` : ''}
              <button class="primary boss-select" data-boss="${boss.id}" type="button" ${currentState.activeBossId && currentState.activeBossId !== boss.id ? 'disabled' : ''}>
                ${currentState.activeBossId && currentState.activeBossId !== boss.id
      ? 'Бой уже выбран'
      : (boss.defeated ? (remainingKills > 0 ? 'Пройти ещё раз' : 'Лимит исчерпан') : 'Выбрать и начать бой')}
              </button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('[data-boss]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await syncAction('select_boss', { bossId: btn.dataset.boss });
      setView('battle');
      render();
    };
  });
}

function renderBattleScreen() {
  const activeBoss = bossById(currentState, currentState.activeBossId);
  if (!activeBoss) {
    renderBossSelection();
    return;
  }

  $('#battle-screen-title').textContent = `Бой: ${activeBoss.name}`;
  const battleRemaining = activeBoss.defeated ? '' : bossBattleCountdown(activeBoss);
  $('#battle-screen-subtitle').textContent = activeBoss.defeated
    ? activeBoss.killsToday >= BOSS_KILL_LIMIT ? 'Дневной лимит этого босса исчерпан.' : `Босс уже побеждён. Можно пройти ещё раз. Осталось ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT} попыток на сегодня. Опыт за победу: ${activeBoss.xp || 0}.`
    : `Удары идут снизу панели. После каждого удара босс отвечает, если ещё жив. Битва закончится через ${battleRemaining}. На этом боссе сегодня осталось: ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT}. Опыт за победу: ${activeBoss.xp || 0}. Раньше завершить бой можно только за 1 кормик.`;

  const body = $('#battle-screen-body');
  const percent = activeBoss.maxHp ? Math.max(0, Math.min(100, (activeBoss.hp / activeBoss.maxHp) * 100)) : 0;
  const cat = CATALOG.bosses.find((item) => item.id === activeBoss.id) || activeBoss;
  const isBattleExpired = !activeBoss.defeated && activeBoss.battleEndsAt && toMillis(activeBoss.battleEndsAt) <= Date.now();

  body.innerHTML = `
    <div class="battle-top">
      <div class="battle-portrait">
        <img src="${cat.img}" alt="${activeBoss.name}" />
      </div>
      <div class="battle-info">
        <div class="battle-info__head">
          <strong>${activeBoss.name}</strong>
          <span>${activeBoss.defeated ? 'Побеждён' : `HP ${activeBoss.hp}/${activeBoss.maxHp}`}</span>
        </div>
        <div class="battle-bar"><div style="width: ${percent}%"></div></div>
        <div class="battle-reward">Награда: ${bossRewardText(activeBoss)}</div>
        <div class="battle-xp">Опыт: ${activeBoss.xp || 0}</div>
        <div class="battle-note">${activeBoss.defeated ? 'Босс уже побеждён. Выбирай следующего.' : `Битва закончится через ${battleRemaining}. На этом боссе сегодня осталось: ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT}.`}${isBattleExpired ? ' Время вышло, бой проигран.' : ''}</div>
        <div class="battle-controls">
          ${activeBoss.defeated && bossDailyRemaining(activeBoss) > 0 ? '<button class="primary" id="btn-boss-retry" type="button">Пройти ещё раз</button>' : ''}
          ${activeBoss.defeated || isBattleExpired
            ? '<button class="ghost" id="btn-boss-change" type="button">Выбрать другого</button>'
            : '<button class="primary" id="btn-boss-finish" type="button">Выйти из битвы досрочно за 1 кормик</button>'}
        </div>
      </div>
    </div>

    <div class="attack-panel">
      ${ATTACKS.map((attack) => {
        const cd = bossAttackCooldownRemaining(activeBoss, attack.id);
        const cooldownUntil = cleanTimestamp(activeBoss.attackCooldowns?.[attack.id]);
        const owned = attackOwnedCount(currentState, attack.id);
        const canBuy = (attack.costWheat || 0) > 0 && (currentState.player.currency?.wheat || 0) >= (attack.costWheat || 0);
        const lockedByCost = (attack.costWheat || 0) > 0 && owned <= 0 && !canBuy;
        const disabled = activeBoss.defeated || (cooldownUntil && toMillis(cooldownUntil) > Date.now()) || lockedByCost;
        const actualDamage = attackDamage(currentState, attack.id);
        const subtitle = attack.costWheat > 0
          ? (owned > 0 ? `Зарядов: ${owned}${cd ? ` • ${cd}` : ''}` : `Купить за ${attack.costWheat} пшеницы${cd ? ` • ${cd}` : ''}`)
          : `Бесплатно${cd ? ` • ${cd}` : ''}`;
        return `<button class="attack-btn ${owned > 0 || attack.costWheat === 0 ? 'is-ready' : 'is-buyable'}" data-attack="${attack.id}" ${disabled ? 'disabled' : ''}>
          <span>${attack.label}</span>
          <strong>${actualDamage} урона</strong>
          <small>${subtitle}</small>
        </button>`;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('[data-attack]').forEach((btn) => {
    btn.onclick = async () => {
      const attackType = btn.dataset.attack;
      const attack = ATTACKS.find((item) => item.id === attackType);
      const owned = attackOwnedCount(currentState, attackType);
      if (attack && attack.costWheat > 0 && owned <= 0) {
        const buyResponse = await syncAction('buy_attack', { attackType });
        if (!(buyResponse?.ok || buyResponse?.data?.state)) {
          return;
        }
      }
      btn.disabled = true;
      await syncAction('attack_boss', { attackType });
      setView('battle');
      render();
    };
  });

  const retry = $('#btn-boss-retry');
  if (retry) {
    retry.onclick = async () => {
      await syncAction('retry_boss', {});
      setView('battle');
      render();
    };
  }

  const finish = $('#btn-boss-finish');
  if (finish) {
    finish.onclick = () => openBattleFinishModal(activeBoss);
  }

  const change = $('#btn-boss-change');
  if (change) {
    change.onclick = async () => {
      await syncAction('clear_boss', {});
      setView('battle');
      render();
    };
  }
}

function renderAdventureScreen() {
  const selectedId = selectedAdventureId(currentState);
  const selected = getAdventureNode(currentState, selectedId) || currentState.adventure[0];
  const def = getAdventureDef(selected?.id || ADVENTURE_DEFS[0].id);
  const isSelectedLocked = selected ? isAdventureLocked(currentState, currentState.adventure.findIndex((n) => n.id === selected.id)) : false;
  const progress = selected ? `${selected.progress}/${selected.requiredPasses}` : '0/0';
  const energy = currentState.player.energy || 0;
  const maxEnergy = currentState.player.maxEnergy || 40;
  const nodePct = selected && selected.requiredPasses > 0 ? Math.max(0, Math.min(100, (selected.progress / selected.requiredPasses) * 100)) : 0;

  $('#battle-screen').hidden = true;
  const body = $('#adventure-screen-body');
  if (!body) return;

  body.innerHTML = `
    <div class="adventure-layout">
      <div class="adventure-map-shell">
        <div class="adventure-map">
          <img class="adventure-map__bg" src="/assets/adventure/map.png" alt="Карта приключений">
          <div class="adventure-map__overlay"></div>

          ${currentState.adventure.map((node) => {
            const defNode = getAdventureDef(node.id);
            const idx = currentState.adventure.findIndex((n) => n.id === node.id);
            const locked = isAdventureLocked(currentState, idx);
            const classes = [
              'adventure-node',
              node.completed ? 'is-complete' : '',
              node.id === selectedId ? 'is-active' : '',
              locked ? 'is-locked' : '',
              pendingAdventureShakeId === node.id ? 'is-shaking' : '',
            ].filter(Boolean).join(' ');
            const reward = ADVENTURE_REWARDS[idx] || { xp: 0, seeds: 0 };
            return `
              <button
                type="button"
                class="${classes}"
                data-adventure-node="${node.id}"
                aria-label="${node.name} • ${node.energyCost} энергии за проход • ${node.progress}/${node.requiredPasses} • даёт +${reward.xp} опыта и +${reward.seeds} семечек"
                style="left: ${defNode.x}%; top: ${defNode.y}%"
                ${locked ? 'disabled' : ''}
              >
                <span class="adventure-node__ring"></span>
                <img src="${defNode.image}" alt="${node.name}">
                <span class="adventure-node__badge">${idx + 1}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>

      <aside class="adventure-panel">
        <div class="adventure-panel__head">
          <div class="eyebrow">Карта приключений</div>
          <h3>${selected?.name || '—'}</h3>
          <p>${isSelectedLocked ? 'Следующая точка пока недоступна.' : 'Выбери точку и трать энергию на прохождение.'}</p>
        </div>

        <div class="adventure-stats">
          <div class="stat-box">
            <span>Стоимость за проход</span>
            <strong>${selected?.energyCost ?? 0} энергии</strong>
          </div>
          <div class="stat-box">
            <span>Пройдено</span>
            <strong>${progress}</strong>
          </div>
          <div class="stat-box">
            <span>Награда за действие</span>
            <strong>${adventureRewardLabel(currentState.adventure.findIndex((n) => n.id === selected.id))}</strong>
          </div>
          <div class="stat-box">
            <span>Энергия</span>
            <strong>${energy}/${maxEnergy}</strong>
          </div>
        </div>

        <div class="meter-block">
          <div class="meter-label">
            <span>Прогресс точки</span>
            <strong>${nodePct.toFixed(0)}%</strong>
          </div>
          <div class="progress-bar"><div style="width: ${nodePct}%"></div></div>
        </div>


        <div class="adventure-actions">
          <button
            type="button"
            id="btn-adventure-step"
            class="primary"
            ${!selected || selected.completed || isSelectedLocked || energy < (selected?.energyCost || 0) ? 'disabled' : ''}
          >
            ${selected && !selected.completed ? `Пройти за ${selected.energyCost} энергии • +${ADVENTURE_REWARDS[currentState.adventure.findIndex((n) => n.id === selected.id)]?.xp || 0} опыта` : 'Точка пройдена'}
          </button>
          <button type="button" id="btn-adventure-back" class="ghost">Вернуться к сцене</button>
        </div>

        <div class="adventure-note">
          ${selected?.completed
            ? 'Эта точка уже пройдена. Можно посмотреть другие участки карты.'
            : `Нужно ${selected?.requiredPasses || 0} проходов по ${selected?.energyCost || 0} энергии. За каждый успешный проход: ${adventureRewardLabel(currentState.adventure.findIndex((n) => n.id === selected.id))}.`}
        </div>
      </aside>
    </div>
  `;

  document.querySelectorAll('[data-adventure-node]').forEach((btn) => {
    btn.onclick = async () => {
      const nodeId = btn.dataset.adventureNode;
      await syncAction('select_adventure', { nodeId });
      setView('adventure');
      render();
    };
  });

  const step = $('#btn-adventure-step');
  if (step && selected && !selected.completed && !isSelectedLocked) {
    step.onclick = async () => {
      pendingAdventureShakeId = selected.id;
      step.disabled = true;
      await syncAction('adventure_step', { nodeId: selected.id });
      setView('adventure');
      render();
    };
  }

  const back = $('#btn-adventure-back');
  if (back) {
    back.onclick = () => {
      setView('main');
      render();
    };
  }

  if (pendingAdventureShakeId) {
    window.setTimeout(() => {
      const el = document.querySelector(`[data-adventure-node="${pendingAdventureShakeId}"]`);
      if (el) {
        el.classList.add('is-shaking');
        window.setTimeout(() => el.classList.remove('is-shaking'), 380);
      }
      pendingAdventureShakeId = null;
    }, 0);
  }
}

function renderAppearanceOptionButton(option, slot) {
  const selected = (currentState.player.appearance?.[slot] || (slot === 'background' ? currentState.player.wallpaper : 'none')) === option.id;
  const thumbStyle = option.color ? `style="--chip-color: ${option.color};"` : '';
  const thumbImage = option.img
    ? `<img class="appearance-option__img ${slot === 'color' ? 'appearance-option__img--hamster' : ''}" src="${option.img}" alt="" />`
    : `<span class="appearance-thumb-fallback">${option.name.slice(0, 2)}</span>`;
  const locked = slot === 'color' && option.id !== 'default' && (currentState.player.inventory?.[option.id] || 0) <= 0;
  return `
    <button type="button" class="appearance-option ${selected ? 'is-selected' : ''} ${locked ? 'is-locked' : ''}" data-appearance-slot="${slot}" data-appearance-value="${option.id}" ${locked ? 'disabled aria-disabled="true" title="Сначала выбей этот скин"' : ''}>
      <div class="appearance-option__thumb" ${thumbStyle}>${thumbImage}</div>
      <div class="appearance-option__text">
        <strong>${option.name}</strong>
        ${locked ? '<span class="appearance-option__lock">Сначала выбей</span>' : ''}
      </div>
    </button>
  `;
}

function renderEditScreen() {
  const body = $('#edit-screen-body');
  if (!body) return;

  const activeSlot = APPEARANCE_CATEGORIES.find((item) => item.id === editCategory) || APPEARANCE_CATEGORIES[0];
  const options = APPEARANCE_OPTIONS[activeSlot.slot] || [];
  const currentValue = currentState.player.appearance?.[activeSlot.slot] || (activeSlot.slot === 'background' ? currentState.player.wallpaper : 'none');

  body.innerHTML = `
    <div class="edit-layout">
      <div class="edit-preview card">
        <div class="edit-preview__title">
          <div>
            <div class="eyebrow">Предпросмотр</div>
            <h3>${currentState.player.name || 'Хомяк'}</h3>
          </div>
          <div class="tag">${activeSlot.label}</div>
        </div>
        <div class="edit-preview__scene" style="background-image: url('${getWallpaperAsset(currentState.player.appearance?.background || currentState.player.wallpaper || 'wallpaper_day').img}')">
          <div class="edit-preview__fog"></div>
          <div class="edit-preview__ground"></div>
          <div class="edit-preview__hamster">
            <div class="ground-shadow"></div>
            <div class="edit-preview__color-layer" hidden></div>
            <img class="edit-preview__base" src="${getHamsterSpriteAsset(currentState.player.appearance?.color || 'default')}" alt="Хомяк" />
            ${currentState.player.appearance?.headwear && currentState.player.appearance.headwear !== 'none' ? `<div class="appearance-layer appearance-layer--headwear appearance-layer--${currentState.player.appearance.headwear}"></div>` : ''}
            ${currentState.player.appearance?.glasses && currentState.player.appearance.glasses !== 'none' ? `<div class="appearance-layer appearance-layer--glasses appearance-layer--${currentState.player.appearance.glasses}"></div>` : ''}
            ${currentState.player.appearance?.mask && currentState.player.appearance.mask !== 'none' ? `<div class="appearance-layer appearance-layer--mask appearance-layer--${currentState.player.appearance.mask}"></div>` : ''}
            ${currentState.player.appearance?.body && currentState.player.appearance.body !== 'none' ? `<div class="appearance-layer appearance-layer--body appearance-layer--${currentState.player.appearance.body}"></div>` : ''}
            ${currentState.player.appearance?.shoes && currentState.player.appearance.shoes !== 'none' ? `<div class="appearance-layer appearance-layer--shoes appearance-layer--${currentState.player.appearance.shoes}"></div>` : ''}
            ${currentState.player.appearance?.heldItem && currentState.player.appearance.heldItem !== 'none' ? `<div class="appearance-layer appearance-layer--heldItem appearance-layer--${currentState.player.appearance.heldItem}"></div>` : ''}
          </div>
        </div>
        <div class="edit-preview__note">Картинки можно заменить на свои AI-слои без загрузки в игре — только фиксированные варианты.</div>
      </div>

      <aside class="edit-panel">
        <div class="edit-panel__tabs">
          ${APPEARANCE_CATEGORIES.map((item) => `
            <button type="button" class="edit-tab ${item.id === activeSlot.id ? 'is-active' : ''}" data-edit-category="${item.id}">
              <span>${item.icon}</span>
              <strong>${item.label}</strong>
            </button>
          `).join('')}
        </div>

        <div class="edit-panel__head">
          <div>
            <div class="eyebrow">${activeSlot.label}</div>
            <h3>${activeSlot.id === 'background' ? 'Выбор фона' : 'Выбор предмета'}</h3>
          </div>
          <div class="tag">Выбрано: ${getAppearanceOption(activeSlot.slot, currentValue)?.name || '—'}</div>
        </div>

        <div class="appearance-grid">
          ${options.map((opt) => renderAppearanceOptionButton(opt, activeSlot.slot)).join('')}
        </div>
      </aside>
    </div>
  `;

  document.querySelectorAll('[data-edit-category]').forEach((btn) => {
    btn.onclick = () => {
      editCategory = btn.dataset.editCategory || 'background';
      render();
    };
  });

  document.querySelectorAll('[data-appearance-slot]').forEach((btn) => {
    btn.onclick = async () => {
      await syncAction('set_appearance', {
        slot: btn.dataset.appearanceSlot,
        value: btn.dataset.appearanceValue,
      });
      render();
    };
  });
}

function render() {
  currentState = normalizeState(currentState);
  currentState = advanceLocalEnergy(currentState);
  $('#player-name-input').value = currentState.player.name || 'Хомяк';
  const authTitle = $('#auth-title');
  if (authTitle) {
    authTitle.textContent = isAuthenticated ? `Добро пожаловать, ${currentUserLogin || currentState.player.name || 'хомяк'}` : 'Вход в игру';
  }
  renderResourceStrip(currentState);
  updateScene(currentState);
  if (document.getElementById('profile-modal')) {
    renderProfileModal(currentState);
  }

  const auth = $('#auth-screen');
  const main = $('#main-screen');
  const battle = $('#battle-screen');
  const adventure = $('#adventure-screen');
  const edit = $('#edit-screen');

  if (auth) auth.hidden = isAuthenticated;
  if (!isAuthenticated) {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    return;
  }

  if (view === 'battle') {
    main.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    battle.hidden = false;
    renderBattleScreen();
  } else if (view === 'adventure') {
    main.hidden = true;
    battle.hidden = true;
    edit.hidden = true;
    adventure.hidden = false;
    renderAdventureScreen();
  } else if (view === 'edit') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = false;
    renderEditScreen();
  } else {
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    main.hidden = false;
  }
}

function initTopButtons() {
  const hamsterStage = document.getElementById('hamster-stage');
  if (hamsterStage) {
    hamsterStage.onclick = () => {
      setView('edit');
      render();
    };
    hamsterStage.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setView('edit');
        render();
      }
    };
  }

  $('#btn-save-name').onclick = async () => {
    const name = $('#player-name-input').value.trim();
    if (!name) return;
    const response = await api('/name', { name });
    if (response.ok && response.data && response.data.state) {
      currentState = normalizeState(response.data.state);
    } else {
      currentState.player.name = name;
    }
    render();
  };

  $('#btn-new').onclick = async () => {
    currentState = normalizeState(DEFAULT_STATE);
    setView('main');
    await syncAction('new_run', {});
    render();
  };

  const profileButton = $('#btn-profile');
  if (profileButton) {
    profileButton.onclick = () => {
      openProfileModal();
    };
  }

  $('#btn-battle-panel').onclick = () => {
    setView('battle');
    render();
  };

  $('#btn-map-panel').onclick = () => {
    setView('adventure');
    render();
  };
}

function initBattleButtons() {
  $('#btn-battle-back').onclick = () => {
    setView('main');
    render();
  };

  ensureBattleFinishModal();
  document.querySelectorAll('[data-battle-finish-close]').forEach((btn) => {
    btn.onclick = closeBattleFinishModal;
  });
  const finishConfirm = document.getElementById('battle-finish-confirm');
  if (finishConfirm) {
    finishConfirm.onclick = confirmBattleFinish;
  }

  ensureProfileModal();
  document.querySelectorAll('[data-profile-close]').forEach((btn) => {
    btn.onclick = closeProfileModal;
  });
}

function initAdventureButtons() {
  const topBack = $('#btn-adventure-back-top');
  if (topBack) {
    topBack.onclick = () => {
      setView('main');
      render();
    };
  }
}

function initEditButtons() {
  const back = $('#btn-edit-back');
  if (back) {
    back.onclick = () => {
      setView('main');
      render();
    };
  }
}


async function submitAuth(mode) {
  const authError = $('#auth-error');
  if (authError) authError.textContent = '';
  const login = $('#auth-login').value.trim();
  const password = $('#auth-password').value;
  const response = await api(`/auth/${mode}`, { login, password });
  if (response.ok && response.data && response.data.token && response.data.state) {
    setAuthToken(response.data.token);
    currentState = normalizeState(response.data.state);
    currentUserLogin = response.data.user || login;
    isAuthenticated = true;
    restoreViewFromState(currentState);
    if (!currentState.activeBossId) setView('main');
    render();
    return;
  }

  const message = response.data && response.data.error ? response.data.error : 'Не удалось войти';
  if (authError) authError.textContent = message;
}

function initAuthButtons() {
  const loginBtn = $('#btn-auth-login');
  const registerBtn = $('#btn-auth-register');
  const logoutBtn = $('#btn-logout');
  if (loginBtn) loginBtn.onclick = () => submitAuth('login');
  if (registerBtn) registerBtn.onclick = () => submitAuth('register');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api('/auth/logout', {}, 'POST');
      setAuthToken('');
      isAuthenticated = false;
      currentUserLogin = '';
      currentState = normalizeState(DEFAULT_STATE);
      render();
    };
  }
}

let uiTicker = null;

window.addEventListener('DOMContentLoaded', async () => {
  initAuthButtons();
  initTopButtons();
  initBattleButtons();
  initAdventureButtons();
  initEditButtons();
  render();
  await loadState();

  if (!uiTicker) {
    uiTicker = window.setInterval(() => {
      currentState = advanceLocalEnergy(currentState);
      render();
    }, 1000);
  }
});