function renderAccessoryMarkup(slot, value) {
  if (!value || value === 'none') return '';
  const item = getAppearanceOption(slot, value);
  if (!item) return '';
  const label = item.name || value;
  return `<div class="appearance-layer appearance-layer--${slot} appearance-layer--${value}">${label}</div>`;
}

const BUSINESS_UNLOCK_LEVEL = 12;
const BUSINESS_CYCLE_MS = 12 * 60 * 60 * 1000;

const BUSINESS_DEFS = {
  shop: {
    id: 'shop',
    name: 'Магазин',
    image: '/assets/business/shop.png',
    purchaseCost: 1000,
    upgradeBaseCost: 500,
    upgradeStep: 50,
    rewardLabel: 'семечек',
    rewardPerLevel: 10,
    action: 'buy_business_shop',
    description: 'Даёт семечки каждые 12 часов.',
  },
  wheel: {
    id: 'wheel',
    name: 'Колёсико',
    image: '/assets/business/wheel.png',
    purchaseCost: 500,
    upgradeBaseCost: 300,
    upgradeStep: 40,
    rewardLabel: 'опыта',
    rewardPerLevel: 1,
    action: 'buy_business_wheel',
    description: 'Даёт опыт каждые 12 часов.',
  },
};

const EXCHANGE_DEFS = [
  { id: 'wheat_to_seeds', from: 'wheat', to: 'seeds', rate: 100, action: 'exchange_wheat_to_seeds' },
  { id: 'carrot_to_wheat', from: 'carrot', to: 'wheat', rate: 2, action: 'exchange_carrot_to_wheat' },
  { id: 'cucumber_to_carrot', from: 'cucumber', to: 'carrot', rate: 2, action: 'exchange_cucumber_to_carrot' },
  { id: 'apple_to_cucumber', from: 'apple', to: 'cucumber', rate: 2, action: 'exchange_apple_to_cucumber' },
  { id: 'kormik_to_apple', from: 'kormik', to: 'apple', rate: 12, action: 'exchange_kormik_to_apple' },
];

const EXCHANGE_MENU_IMAGE = '/assets/business/exchange_menu.png';
const EXCHANGE_MASCOT_IMAGE = '/assets/business/exchange_hamster.png';

const COIN_GAME_UNLOCK_LEVEL = 6;
const COIN_GAME_COST_CARROTS = 1;
const COIN_GAME_XP_TO_LEVEL = 10;
const COIN_GAME_ART = {
  intro: '/assets/coin/coin_main.png',
  hamster: '/assets/coin/coin_hamster.png',
  mouse: '/assets/coin/coin_mouse.png',
  video: '/assets/coin/coin_intro.mp4',
};

let coinGameUI = {
  phase: 'ready',
  choice: '',
  pendingChoice: '',
  result: null,
  message: '',
  videoToken: 0,
  videoFallback: null,
};

let lootBoxUI = {
  phase: 'ready',
  message: '',
};

const ADVENTURE_MAP_KEY = 'humster_adventure_map';
const ADVENTURE_MAPS = {
  field: { id: 'field', label: 'Поле', image: '/assets/maps/adventure-select/field.png', note: 'Текущая карта.' },
  desert: { id: 'desert', label: 'Пустыня', image: '/assets/maps/adventure-select/desert.png', note: 'Откроется после полного прохождения поля.' },
  cave: { id: 'cave', label: 'Пещера', image: '/assets/maps/adventure-select/cave.png', note: 'Откроется после полного прохождения поля.' },
};

function businessState(state) {
  return state?.business || {};
}

function businessUpgradeCost(def, level) {
  if (level <= 0) return def.purchaseCost;
  if (level >= 100) return 0;
  return def.upgradeBaseCost + def.upgradeStep * (level - 1);
}

function businessRewardAmount(def, level) {
  return Math.max(0, Number(level) || 0) * def.rewardPerLevel;
}

function businessNextClaimCountdown(lastClaimAt) {
  const ms = toMillis(lastClaimAt);
  if (!ms) return '';
  const elapsed = Date.now() - ms;
  const remaining = BUSINESS_CYCLE_MS - (elapsed % BUSINESS_CYCLE_MS);
  return formatCountdown(remaining);
}

function advanceLocalBusiness(state) {
  if (!state || !state.player) return state;
  const next = state;
  const business = next.business || {};
  const now = Date.now();

  const shopLevel = Math.max(0, Math.min(100, Number(business.shopLevel) || 0));
  if (shopLevel > 0) {
    const key = 'shopLastClaimAt';
    const lastTick = toMillis(business[key]) || now;
    if (!business[key] || !toMillis(business[key])) {
      business[key] = new Date(now).toISOString();
    } else {
      const elapsed = now - lastTick;
      if (elapsed >= BUSINESS_CYCLE_MS) {
        const cycles = Math.floor(elapsed / BUSINESS_CYCLE_MS);
        const payout = cycles * businessRewardAmount(BUSINESS_DEFS.shop, shopLevel);
        if (payout > 0) {
          next.player.currency.seeds = Math.max(0, Number(next.player.currency.seeds) || 0) + payout;
        }
        business[key] = new Date(lastTick + (cycles * BUSINESS_CYCLE_MS)).toISOString();
      }
    }
  }

  const wheelLevel = Math.max(0, Math.min(100, Number(business.wheelLevel) || 0));
  if (wheelLevel > 0) {
    const key = 'wheelLastClaimAt';
    const lastTick = toMillis(business[key]) || now;
    if (!business[key] || !toMillis(business[key])) {
      business[key] = new Date(now).toISOString();
    } else {
      const elapsed = now - lastTick;
      if (elapsed >= BUSINESS_CYCLE_MS) {
        const cycles = Math.floor(elapsed / BUSINESS_CYCLE_MS);
        const payout = cycles * businessRewardAmount(BUSINESS_DEFS.wheel, wheelLevel);
        if (payout > 0) {
          next.player.xp = Math.max(0, Number(next.player.xp) || 0) + payout;
          recalcLevel(next);
        }
        business[key] = new Date(lastTick + (cycles * BUSINESS_CYCLE_MS)).toISOString();
      }
    }
  }

  next.business = business;
  return next;
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
    { label: 'Семечки', value: `${currencies.seeds || 0}`, icon: CURRENCY_ICONS.seeds },
    { label: 'Пшеница', value: `${currencies.wheat || 0}`, icon: CURRENCY_ICONS.wheat },
    { label: 'Морковь', value: `${currencies.carrot || 0}`, icon: CURRENCY_ICONS.carrot },
    { label: 'Огурцы', value: `${currencies.cucumber || 0}`, icon: CURRENCY_ICONS.cucumber },
    { label: 'Яблоки', value: `${currencies.apple || 0}`, icon: CURRENCY_ICONS.apple },
    { label: 'Кормик', value: `${currencies.kormik || 0}`, icon: CURRENCY_ICONS.kormik },
    { label: 'Энергия', value: `${p.energy || 0}/${p.maxEnergy || 40}`, icon: CURRENCY_ICONS.energy, sub: getEnergyCountdown(state) },
  ];

  $('#resource-strip').innerHTML = chips.map((chip) => `
    <div class="hud-chip ${chip.accent ? 'hud-chip--accent' : ''}">
      <div class="hud-chip__label">
        ${chip.icon ? `<img class="hud-chip__icon" src="${chip.icon}" alt="" aria-hidden="true">` : ''}
        <span>${chip.label}</span>
      </div>
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
  const hamsterScale = getHamsterScale(appearance.size || 'normal', appearance.color || 'default');
  const spriteLayer = $('#hamster-sprite');
  if (spriteLayer) {
    spriteLayer.src = hamsterSprite;
  }
  const stage = $('#hamster-stage');
  if (stage) {
    stage.style.setProperty('--hamster-scale', hamsterScale);
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
  const ownedBlack = Number(state?.player?.inventory?.black || 0) > 0;
  const ownedCigarette = Number(state?.player?.inventory?.cigarette_skin || 0) > 0;
  let bonus = 0;
  if (attackType === 'belly_punch' || attackType === 'iron_claw') {
    bonus += ownedColor2 ? 5 : 0;
  }
  if (attackType === 'iron_claw') {
    bonus += ownedBlack ? 10 : 0;
    const ownedWreath = Number(state?.player?.inventory?.wreath_skin || 0) > 0;
    const ownedStone = Number(state?.player?.inventory?.stone_skin || 0) > 0;
    if (ownedWreath && ownedStone) bonus += 20;
  }
  if (attackType === 'poison_bite') {
    bonus += (ownedColor1 || ownedCigarette) ? 20 : 0;
  }
  const ownedVans = Number(state?.player?.inventory?.vans_skin || 0) > 0;
  const ownedTshirt = Number(state?.player?.inventory?.['t-shirt_skin'] || 0) > 0;
  if (ownedVans && ownedTshirt) {
    if (attackType === 'rush') bonus += 5;
    if (attackType === 'belly_punch') bonus += 5;
    if (attackType === 'iron_claw') bonus += 10;
  }
  const ownedPrize = Number(state?.player?.inventory?.prize_skin || 0) > 0;
  const ownedFestiveCap = Number(state?.player?.inventory?.festive_cap_skin || 0) > 0;
  const ownedFestiveTiugue = Number(state?.player?.inventory?.festive_tiugue_skin || 0) > 0;
  if (ownedPrize && ownedFestiveCap && ownedFestiveTiugue) {
    if (attackType === 'bite') bonus += 5;
    if (attackType === 'eye_lasers') bonus += 30;
    if (attackType === 'rush') bonus += 10;
  }
  for (const [, setDef] of Object.entries(BOSS_HARD_MODE_SET_BONUSES || {})) {
    if (attackType === setDef.attackType) {
      const allCollected = setDef.requiredItems.every((itemId) => (state?.player?.inventory?.[itemId] || 0) > 0);
      if (allCollected) {
        bonus += setDef.bonus;
      }
    }
  }
  // Набор механиков
  const ownedMehanic = ['adjustable_wrench', 'mehanic_costume', 'mehanic_but', 'mehanic_cup'].every((id) => (state?.player?.inventory?.[id] || 0) > 0);
  if (ownedMehanic) {
    if (attackType === 'iron_claw') bonus += 10;
    if (attackType === 'belly_punch') bonus += 5;
    if (attackType === 'eye_lasers') bonus += 10;
  }
  // Набор мясников
  const ownedMeat = ['cleaver', 'mustache', 'meat_cup', 'meat_apron'].every((id) => (state?.player?.inventory?.[id] || 0) > 0);
  if (ownedMeat) {
    if (attackType === 'scratch') bonus += 10;
    if (attackType === 'iron_claw') bonus += 20;
    if (attackType === 'bite') bonus += 10;
  }
  return bonus;
}

function attackDamage(state, attackType) {
  const attack = ATTACKS.find((item) => item.id === attackType);
  const talentBonus = typeof getTalentAttackBonus === 'function' ? getTalentAttackBonus(state, attackType) : 0;
  return attack ? attack.damage + skinBonusDamage(state, attackType) + talentBonus : 0;
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

function attackConsumesChargeWithoutCooldown(attackType) {
  return attackType === 'iron_claw' || attackType === 'poison_bite' || attackType === 'eye_lasers';
}

function applyLocalAction(action, payload = {}) {
  const state = currentState;
  advanceLocalBusiness(state);
  const bossIndex = state.bosses.findIndex((boss) => boss.id === state.activeBossId);
  const boss = bossIndex >= 0 ? state.bosses[bossIndex] : null;

  switch (action) {
    case 'select_boss': {
      const bossId = payload.bossId || '';
      const mode = payload.mode || '';
      if (bossIsLocked(state, bossId)) {
        return;
      }
      if (state.activeBossId && state.activeBossId !== bossId) {
        const activeBoss = bossById(state, state.activeBossId);
        if (activeBoss && !activeBoss.defeated && (!activeBoss.battleEndsAt || toMillis(activeBoss.battleEndsAt) > Date.now())) {
          return;
        }
      }
      state.selectedBossMode = mode;
      state.activeBossId = bossId;
      const active = bossById(state, bossId);
      if (active) {
        const remaining = bossDailyRemaining(active);
        const isHardMode = mode === 'homyak' && (bossId === 'rat' || bossId === 'lizard');
        if (active.defeated) {
          if (remaining <= 0) return;
          const now = Date.now();
          active.defeated = false;
          active.mode = isHardMode ? 'homyak' : '';
          active.maxHp = isHardMode ? (BOSS_BLUEPRINTS[bossId]?.hp || active.maxHp) * 3 : (BOSS_BLUEPRINTS[bossId]?.hp || active.maxHp);
          active.hp = active.maxHp;
          active.battleStartedAt = new Date(now).toISOString();
          active.battleEndsAt = new Date(now + (8 * 60 * 60 * 1000)).toISOString();
          active.attackCooldowns = {};
        } else if (!active.battleStartedAt || !active.battleEndsAt) {
          const now = Date.now();
          active.mode = isHardMode ? 'homyak' : '';
          active.maxHp = isHardMode ? (BOSS_BLUEPRINTS[bossId]?.hp || active.maxHp) * 3 : (BOSS_BLUEPRINTS[bossId]?.hp || active.maxHp);
          active.hp = active.maxHp;
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
      const specialChargeAttack = attackConsumesChargeWithoutCooldown(payload.attackType);
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
      const cooldownUntil = specialChargeAttack ? 0 : toMillis(boss.attackCooldowns[payload.attackType]);
      if (cooldownUntil && now < cooldownUntil) return;
      const killsToday = boss.killsDay === bossKillDayKey() ? (boss.killsToday || 0) : 0;
      if (boss.hp - dmg <= 0 && killsToday >= BOSS_KILL_LIMIT) return;
      boss.hp = Math.max(0, boss.hp - dmg);
      if (cost > 0) {
        state.player.inventory[payload.attackType] = Math.max(0, attackOwnedCount(state, payload.attackType) - 1);
      }
      if (specialChargeAttack) {
        delete boss.attackCooldowns[payload.attackType];
      } else {
        boss.attackCooldowns[payload.attackType] = new Date(now + (6 * 60 * 60 * 1000)).toISOString();
      }
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
    case 'buy_business_shop':
    case 'buy_business_wheel': {
      const def = action === 'buy_business_shop' ? BUSINESS_DEFS.shop : BUSINESS_DEFS.wheel;
      const key = action === 'buy_business_shop' ? 'shop' : 'wheel';
      const levelKey = `${key}Level`;
      const timeKey = `${key}LastClaimAt`;
      const currentLevel = Math.max(0, Number(state.business?.[levelKey]) || 0);
      if ((state.player.level || 1) < BUSINESS_UNLOCK_LEVEL) return;
      if (currentLevel >= 100) return;
      const cost = businessUpgradeCost(def, currentLevel);
      if ((state.player.currency.seeds || 0) < cost) return;
      state.player.currency.seeds -= cost;
      state.business = state.business || { shopLevel: 0, shopLastClaimAt: '', wheelLevel: 0, wheelLastClaimAt: '' };
      state.business[levelKey] = currentLevel <= 0 ? 1 : currentLevel + 1;
      if (currentLevel <= 0) {
        state.business[timeKey] = new Date().toISOString();
      }
      return;
    }
    case 'exchange_wheat_to_seeds':
    case 'exchange_carrot_to_wheat':
    case 'exchange_cucumber_to_carrot':
    case 'exchange_apple_to_cucumber':
    case 'exchange_kormik_to_apple': {
      const exchanges = {
        exchange_wheat_to_seeds: { from: 'wheat', to: 'seeds', rate: 100 },
        exchange_carrot_to_wheat: { from: 'carrot', to: 'wheat', rate: 2 },
        exchange_cucumber_to_carrot: { from: 'cucumber', to: 'carrot', rate: 2 },
        exchange_apple_to_cucumber: { from: 'apple', to: 'cucumber', rate: 2 },
        exchange_kormik_to_apple: { from: 'kormik', to: 'apple', rate: 12 },
      };
      const def = exchanges[action];
      if (!def) return;
      const currentAmount = Math.max(0, Number(state.player.currency?.[def.from]) || 0);
      if (currentAmount < 1) return;
      state.player.currency[def.from] = currentAmount - 1;
      state.player.currency[def.to] = Math.max(0, Number(state.player.currency?.[def.to]) || 0) + def.rate;
      return;
    }
    case 'play_coin_game': {
      const choice = String(payload.value || payload.choice || '').trim();
      if (state.player.level < COIN_GAME_UNLOCK_LEVEL) return;
      if (choice !== 'hamster' && choice !== 'mouse') return;
      if (Math.max(0, Number(state.player.currency?.carrot) || 0) < COIN_GAME_COST_CARROTS) {
        return;
      }
      state.player.currency.carrot = Math.max(0, Number(state.player.currency?.carrot) || 0) - COIN_GAME_COST_CARROTS;
      const roll = Math.random() < 0.5 ? 'hamster' : 'mouse';
      const win = roll === choice;
      state.player.coinLastChoice = choice;
      state.player.coinLastRolled = roll;
      state.player.coinLastWon = win;
      if (win) {
        state.player.xp = Math.max(0, Number(state.player.xp) || 0) + 150;
        state.player.currency.seeds = Math.max(0, Number(state.player.currency?.seeds) || 0) + 300;
        state.player.currency.wheat = Math.max(0, Number(state.player.currency?.wheat) || 0) + 3;
        state.player.coinXP = Math.max(0, Number(state.player.coinXP) || 0) + 2;
        state.player.coinLastMessage = 'Победа: +150 опыта хомяка, +300 семечек и +3 пшеницы.';
        appendLog(state, `Монетка: выигрыш по номиналу ${choice}.`);
        recalcLevel(state);
      } else {
        state.player.coinXP = Math.max(0, Number(state.player.coinXP) || 0) + 1;
        state.player.coinLastMessage = 'Поражение: +1 опыта монетки.';
        appendLog(state, `Монетка: проигрыш, выпало ${roll}.`);
      }
      while (state.player.coinXP >= COIN_GAME_XP_TO_LEVEL) {
        state.player.coinXP -= COIN_GAME_XP_TO_LEVEL;
        state.player.coinLevel = Math.max(1, Number(state.player.coinLevel) || 1) + 1;
      }
      return;
    }
    case 'select_adventure_map': {
      const mapId = String(payload.mapId ?? payload.value ?? '').trim();
      if (mapId !== 'field' && !isFieldAdventureCompleted(currentState)) {
        return;
      }
      if (mapId === 'desert' || mapId === 'cave' || mapId === 'field') {
        currentState.activeAdventureMapId = mapId;
        const mapAdventure = currentState.adventureMaps?.[mapId];
        if (Array.isArray(mapAdventure) && mapAdventure.length) {
          currentState.adventure = mapAdventure;
          const firstOpen = mapAdventure.find((node) => !node.completed);
          currentState.activeAdventureId = firstOpen ? firstOpen.id : mapAdventure[0].id;
        }
        currentState.location = mapAdventureLabel(mapId);
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
      const rewardDefs = adventureRewardMapForMap(currentState.activeAdventureMapId || 'field');
      const reward = rewardDefs[idx] || ADVENTURE_REWARDS[idx] || { xp: 0, seeds: 0 };
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
      const inv = currentState.player.inventory || {};
      const SKIN_SHOP_LOCKED = {
        heldItem: { adjustable_wrench: 'adjustable_wrench', cleaver: 'cleaver' },
        headwear: { mehanic_cup: 'mehanic_cup', meat_cup: 'meat_cup' },
        mask: { mustache: 'mustache' },
        body: { mehanic_costume: 'mehanic_costume', meat_apron: 'meat_apron' },
        shoes: { mehanic_but: 'mehanic_but' },
      };
      if (slot === 'color' && value !== 'default' && (inv[value] || 0) <= 0) {
        return;
      }
      if (SKIN_SHOP_LOCKED[slot] && SKIN_SHOP_LOCKED[slot][value] && (inv[value] || 0) <= 0) {
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
    case 'select_talent_class': {
      const classId = String(payload.value ?? payload.classId ?? '').trim();
      const classDef = typeof getTalentClassDefinition === 'function' ? getTalentClassDefinition(classId) : null;
      if (!classDef) return;
      if (currentState.player.talentClass && currentState.player.talentClass !== classId) return;
      currentState.player.talentClass = classId;
      if (!currentState.player.talents || typeof currentState.player.talents !== 'object') {
        currentState.player.talents = {};
      }
      return;
    }
    case 'buy_talent': {
      const skillId = String(payload.slot ?? payload.skillId ?? '').trim();
      if (!skillId) return;
      const skill = typeof getTalentSkillDefinition === 'function' ? getTalentSkillDefinition(skillId) : null;
      if (!skill || skill.wip) return;
      if (currentState.player.talentClass && skill.classId && currentState.player.talentClass !== skill.classId) return;
      const prerequisite = typeof getTalentSkillPrerequisite === 'function' ? getTalentSkillPrerequisite(skillId) : (skill.prerequisite || null);
      if (prerequisite) {
        const prerequisiteRank = Number(currentState.player.talents?.[prerequisite.skillId] || 0);
        if (prerequisiteRank < prerequisite.rank) return;
      }
      if (!currentState.player.talents || typeof currentState.player.talents !== 'object') {
        currentState.player.talents = {};
      }
      const currentRank = Number(currentState.player.talents[skillId] || 0);
      if (currentState.player.talentPoints <= 0 || currentRank >= 10) return;
      currentState.player.talents[skillId] = currentRank + 1;
      currentState.player.talentPoints -= 1;
      currentState.player.talentPointsSpent = Math.max(0, Number(currentState.player.talentPointsSpent) || 0) + 1;
      if (skillId === 'martial_energy') {
        currentState.player.maxEnergy = Math.max(40, Number(currentState.player.maxEnergy) || 40) + 1;
        currentState.player.energy = Math.min(currentState.player.maxEnergy, (Number(currentState.player.energy) || 0) + 1);
      }
      return;
    }
    default:
      return;
  }
}

function isBusinessAction(action) {
  return action === 'buy_business_shop' || action === 'buy_business_wheel';
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

  // Бизнес должен быть отзывчивым даже если сервер ответил ошибкой без
  // актуального состояния: локальная логика здесь полностью совпадает с backend.
  if (!response.ok && isBusinessAction(action)) {
    applyLocalAction(action, payload);
  }

  render();
  return response;
}


function bossUnlockPasses(bossId) {
  switch ((bossId || '').trim()) {
    case 'sand_lizard':
    case 'sand_snake':
    case 'cave_centipede':
    case 'cave_bird':
    case 'cave_spider':
    case 'honey_badger':
      return 1;
    default:
      return 0;
  }
}

function desertBossIds() {
  return new Set(['desert_owl', 'desert_fox', 'grizzly']);
}

function caveBossIds() {
  return new Set(['foot', 'dog', 'machine']);
}

function adventureMapCompleted(state, mapId) {
  const clears = state?.adventureClears || {};
  if (clears?.[mapId]) return true;
  const passes = Math.max(0, Number(state?.locationPasses) || 0);
  if (mapId === 'field' && passes > 0) return true;
  const maps = state?.adventureMaps || {};
  const nodes = maps?.[mapId];
  if (!Array.isArray(nodes) || nodes.length === 0) return false;
  return nodes.every((node) => node && node.completed);
}

function bossIsLocked(state, bossId) {
  const id = (bossId || '').trim();
  if (desertBossIds().has(id)) {
    return !adventureMapCompleted(state, 'desert');
  }
  if (caveBossIds().has(id)) {
    return !adventureMapCompleted(state, 'cave');
  }
  const passes = Math.max(0, Number(state?.locationPasses) || 0);
  return passes < bossUnlockPasses(id);
}

function renderBossSelection() {
  $('#battle-screen-title').textContent = 'Выбор босса';
  $('#battle-screen-subtitle').textContent = '';
  const body = $('#battle-screen-body');

  const hasModeSelection = (bossId) => bossId === 'rat' || bossId === 'lizard';

  body.innerHTML = `
    <div class="boss-grid">
      ${(currentState.bosses || []).map((boss) => {
        const cat = CATALOG.bosses.find((item) => item.id === boss.id) || boss;
        const rewardText = bossRewardText(boss);
        const hpText = `${boss.maxHp || boss.hp} HP`;
        const battleTimer = !boss.defeated && boss.battleEndsAt ? bossBattleCountdown(boss) : '';
        const remainingKills = bossDailyRemaining(boss);
        const bossLocked = bossIsLocked(currentState, boss.id);
        const isDesertBoss = desertBossIds().has(boss.id);
        const isCaveBoss = caveBossIds().has(boss.id);
        const anotherBossActive = !!(currentState.activeBossId && currentState.activeBossId !== boss.id);
        const disabled = bossLocked || anotherBossActive;
        const showMode = hasModeSelection(boss.id) && !bossLocked && !anotherBossActive && (boss.defeated || !boss.battleEndsAt || toMillis(boss.battleEndsAt) <= Date.now());
        const unlockText = isDesertBoss
          ? 'Откроется после прохождения пустыни'
          : (caveBossIds().has(boss.id)
            ? 'Откроется после полного прохождения пещеры'
            : 'Откроется после 1 полного прохождения поля');
        const buttonLabel = bossLocked
          ? unlockText
          : (anotherBossActive
            ? 'Бой уже выбран'
            : (boss.defeated ? (remainingKills > 0 ? 'Пройти ещё раз' : 'Лимит исчерпан') : 'Выбрать и начать бой'));

        if (showMode) {
          const baseHp = BOSS_BLUEPRINTS[boss.id]?.hp || boss.maxHp;
          return `
            <article class="boss-card boss-card--mode-select ${bossLocked ? 'is-locked' : ''}">
              <img class="boss-card__img" src="${cat.img}" alt="${boss.name}" />
              <div class="boss-card__body">
                <div class="boss-card__title">
                  <strong>${boss.name}</strong>
                  <span>${baseHp} HP</span>
                </div>
                <div class="boss-card__reward">Награда: ${rewardText}</div>
                <div class="boss-card__xp">Опыт: ${boss.xp || 0}</div>
                <div class="boss-card__limit">Осталось сегодня: ${remainingKills}/${BOSS_KILL_LIMIT}</div>
                <div class="boss-mode-select">
                  <div class="boss-mode-select__title">Выбери сложность:</div>
                  <div class="boss-mode-select__options">
                    ${BOSS_MODES.map((mode) => `
                      <button class="boss-mode-option" data-boss="${boss.id}" data-mode="${mode.id}" type="button">
                        <img class="boss-mode-option__img" src="${mode.img}" alt="${mode.label}" />
                        <strong class="boss-mode-option__label">${mode.label}</strong>
                        <span class="boss-mode-option__desc">${mode.description}${mode.id === 'homyak' ? ` (${baseHp * 3} HP)` : ''}</span>
                      </button>
                    `).join('')}
                  </div>
                </div>
              </div>
            </article>
          `;
        }

        return `
          <article class="boss-card ${boss.defeated ? 'is-defeated' : ''} ${bossLocked ? 'is-locked' : ''}">
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
              ${bossLocked ? `<div class="boss-card__lock">${isDesertBoss ? 'Откроется после прохождения пустыни.' : (caveBossIds().has(boss.id) ? 'Откроется после полного прохождения пещеры.' : 'Откроется после 1 полного прохождения поля.')}</div>` : ''}
              ${anotherBossActive ? `<div class="boss-card__lock">Сначала заверши текущую битву с ${bossById(currentState, currentState.activeBossId)?.name || 'другим боссом'}.</div>` : ''}
              <button class="primary boss-select" data-boss="${boss.id}" type="button" ${disabled ? 'disabled' : ''}>
                ${buttonLabel}
              </button>
            </div>
          </article>
        `;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('.boss-mode-option').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await syncAction('select_boss', { bossId: btn.dataset.boss, mode: btn.dataset.mode || '' });
      setView('battle');
      render();
    };
  });

  document.querySelectorAll('[data-boss]:not(.boss-mode-option)').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      await syncAction('select_boss', { bossId: btn.dataset.boss, mode: '' });
      setView('battle');
      render();
    };
  });
}


function getAdventureMapChoice() {
  const saved = String(localStorage.getItem(ADVENTURE_MAP_KEY) || '').trim();
  const stateMap = String(currentState?.activeAdventureMapId || '').trim();
  const mapId = ADVENTURE_MAPS[stateMap] ? stateMap : (ADVENTURE_MAPS[saved] ? saved : 'field');
  return ADVENTURE_MAPS[mapId] || ADVENTURE_MAPS.field;
}

function isFieldAdventureCompleted(state = currentState) {
  return adventureMapCompleted(state, 'field');
}

function isAdventureMapUnlocked(mapId) {
  if (mapId === 'field') return true;
  return isFieldAdventureCompleted(currentState);
}

async function setAdventureMapChoice(mapId) {
  const next = ADVENTURE_MAPS[String(mapId || '').trim()] || ADVENTURE_MAPS.field;
  if (!isAdventureMapUnlocked(next.id)) {
    return next;
  }
  const response = await syncAction('select_adventure_map', { mapId: next.id });
  if (response.ok) {
    localStorage.setItem(ADVENTURE_MAP_KEY, next.id);
  }
  return next;
}

function adventureRouteDefsForMap(mapId) {
  return (ADVENTURE_ROUTE_DEFS && ADVENTURE_ROUTE_DEFS[mapId]) || ADVENTURE_ROUTE_DEFS.field;
}

function adventureRewardMapForMap(mapId) {
  return (ADVENTURE_REWARD_MAPS && ADVENTURE_REWARD_MAPS[mapId]) || ADVENTURE_REWARD_MAPS.field;
}

function mapAdventureLabel(mapId) {
  if (mapId === 'desert') return 'Пустыня';
  if (mapId === 'cave') return 'Пещера';
  return 'Поле';
}

function renderAdventureMapSelectScreen() {
  const body = $('#adventure-select-screen-body');
  if (!body) return;
  const activeMap = getAdventureMapChoice();
  body.innerHTML = `
    <div class="adventure-select">
      <div class="adventure-select__map">
        <img class="adventure-select__bg" src="/assets/maps/adventure-select/map_choice.png" alt="Выбор карты">
        <div class="adventure-select__overlay"></div>
        <button type="button" class="adventure-select__node ${activeMap.id === 'field' ? 'is-active' : ''}" data-adventure-map="field" style="left: 50%; top: 58%;">
          <img src="/assets/maps/adventure-select/field.png" alt="Поле">
          <span>Поле</span>
        </button>
        <button type="button" class="adventure-select__node ${activeMap.id === 'desert' ? 'is-active' : ''} ${isAdventureMapUnlocked('desert') ? '' : 'is-locked'}" data-adventure-map="desert" style="left: 68%; top: 40%;" ${isAdventureMapUnlocked('desert') ? '' : 'disabled'}>
          <img src="/assets/maps/adventure-select/desert.png" alt="Пустыня">
          <span>Пустыня</span>
        </button>
        <button type="button" class="adventure-select__node ${activeMap.id === 'cave' ? 'is-active' : ''} ${isAdventureMapUnlocked('cave') ? '' : 'is-locked'}" data-adventure-map="cave" style="left: 28%; top: 35%;" ${isAdventureMapUnlocked('cave') ? '' : 'disabled'}>
          <img src="/assets/maps/adventure-select/cave.png" alt="Пещера">
          <span>Пещера</span>
        </button>
      </div>
      <div class="adventure-select__legend">
        <div class="social-note">Выбери карту. Пустыня и пещера открываются после полного прохождения поля.</div>
      </div>
    </div>
  `;

  document.querySelectorAll('[data-adventure-map]').forEach((btn) => {
    btn.onclick = async () => {
      const mapId = btn.getAttribute('data-adventure-map') || 'field';
      if (!isAdventureMapUnlocked(mapId)) {
        return;
      }
      await setAdventureMapChoice(mapId);
      setView('adventure');
      render();
    };
  });
}

function renderBattleParticipants(activeBoss) {
  if (!activeBoss) return '';
  const selfLogin = normalizeLogin(currentUserLogin || currentState?.player?.name || '');
  const selfDamage = Math.max(0, Number(currentState?.bossBattleDamageCurrent) || 0);
  const entries = [];
  entries.push({
    login: currentState?.player?.name || currentUserLogin || 'Ты',
    damage: selfDamage,
    self: true,
  });

  const snapshot = socialSnapshotProfile;
  const friends = Array.isArray(snapshot?.friends) ? snapshot.friends : [];
  friends.forEach((friend) => {
    const friendLogin = normalizeLogin(friend?.login || '');
    if (!friendLogin || friendLogin === selfLogin) return;
    const friendState = normalizeState(friend?.state || DEFAULT_STATE);
    if ((friendState.activeBossId || '') !== activeBoss.id) return;
    const damage = Math.max(0, Number(friendState.bossBattleDamageCurrent) || 0);
    if (damage <= 0) return;
    entries.push({
      login: friend.login || 'друг',
      damage,
      self: false,
      profileLogin: friend.login || '',
    });
  });

  if (entries.length <= 1) {
    return `
      <div class="battle-participants">
        <div class="profile-section__head">
          <strong>Участники этой битвы</strong>
          <span>Кто уже наносил урон по этому боссу</span>
        </div>
        <div class="social-note">Пока по этому боссу никто из друзей не бьёт.</div>
      </div>
    `;
  }

  entries.sort((a, b) => b.damage - a.damage);
  return `
    <div class="battle-participants">
      <div class="profile-section__head">
        <strong>Участники этой битвы</strong>
        <span>Кто уже наносил урон по этому боссу</span>
      </div>
      <div class="battle-participants__list">
        ${entries.map((entry) => `
          <div class="battle-participant ${entry.self ? 'is-self' : ''}">
            <button type="button" class="battle-participant__name" ${entry.profileLogin ? `data-battle-participant-profile="${jsStringLiteral(entry.profileLogin)}"` : ''}>${entry.login}</button>
            <strong>${formatAchievementNumber(entry.damage)}</strong>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderBattleScreen() {
  const activeBoss = bossById(currentState, currentState.activeBossId);
  if (isAuthenticated && (!socialSnapshotProfile || Date.now() - socialSnapshotLoadedAt > SOCIAL_SNAPSHOT_REFRESH_MS)) {
    void loadSocialSnapshot();
  }
  if (!activeBoss) {
    renderBossSelection();
    return;
  }

  $('#battle-screen-title').textContent = `Бой: ${activeBoss.name}${activeBoss.mode === 'homyak' ? ' (Хомяк)' : ''}`;
  const battleRemaining = activeBoss.defeated ? '' : bossBattleCountdown(activeBoss);
  $('#battle-screen-subtitle').textContent = activeBoss.defeated
    ? (activeBoss.killsToday >= BOSS_KILL_LIMIT ? 'Дневной лимит этого босса исчерпан.' : 'Босс уже побеждён.')
    : `До конца битвы: ${battleRemaining}.`;

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
        <div class="battle-note">${activeBoss.defeated ? 'Босс уже побеждён. Выбирай следующего.' : `На этом боссе сегодня осталось: ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT}.`}${isBattleExpired ? ' Время вышло, бой проигран.' : ''}</div>
        ${typeof renderTalentBattleWidget === 'function' ? renderTalentBattleWidget(currentState) : ''}
        <div class="battle-controls">
          ${activeBoss.defeated && bossDailyRemaining(activeBoss) > 0 ? '<button class="primary" id="btn-boss-retry" type="button">Пройти ещё раз</button>' : ''}
          ${activeBoss.defeated || isBattleExpired
            ? '<button class="ghost" id="btn-boss-change" type="button">Выбрать другого</button>'
            : '<button class="primary" id="btn-boss-finish" type="button">Выйти из битвы досрочно за 1 кормик</button>'}
        </div>
        ${renderBattleParticipants(activeBoss)}
      </div>
    </div>

    <div class="attack-panel">
      ${ATTACKS.map((attack) => {
        const specialChargeAttack = attackConsumesChargeWithoutCooldown(attack.id);
        const cd = specialChargeAttack ? '' : bossAttackCooldownRemaining(activeBoss, attack.id);
        const cooldownUntil = specialChargeAttack ? '' : cleanTimestamp(activeBoss.attackCooldowns?.[attack.id]);
        const owned = attackOwnedCount(currentState, attack.id);
        const canBuy = (attack.costWheat || 0) > 0 && (currentState.player.currency?.wheat || 0) >= (attack.costWheat || 0);
        const lockedByCost = (attack.costWheat || 0) > 0 && owned <= 0 && !canBuy;
        const disabled = activeBoss.defeated || (!specialChargeAttack && cooldownUntil && toMillis(cooldownUntil) > Date.now()) || lockedByCost;
        const actualDamage = attackDamage(currentState, attack.id);
        const subtitle = attack.costWheat > 0
          ? (owned > 0 ? `Зарядов: ${owned}${cd ? ` • ${cd}` : ''}` : `Купить за ${attack.costWheat} пшеницы${cd ? ` • ${cd}` : ''}`)
          : `Бесплатно${cd ? ` • ${cd}` : ''}`;
        return `<button class="attack-btn ${owned > 0 || attack.costWheat === 0 ? 'is-ready' : 'is-buyable'}" data-attack="${attack.id}" ${disabled ? 'disabled' : ''}>
          <div class="attack-btn__top">
            ${attack.icon ? `<img class="attack-btn__icon" src="${attack.icon}" alt="" aria-hidden="true" />` : ''}
            <span>${attack.label}</span>
          </div>
          <strong>${actualDamage} урона</strong>
          <small>${subtitle}</small>
        </button>`;
      }).join('')}
    </div>
  `;

  document.querySelectorAll('[data-attack]').forEach((btn) => {
    btn.onclick = async () => {
      const attackType = btn.dataset.attack;
      if (!attackType) return;
      btn.disabled = true;
      const attack = ATTACKS.find((item) => item.id === attackType);
      const owned = attackOwnedCount(currentState, attackType);
      if (attack && attack.costWheat > 0 && owned <= 0) {
        const buyResponse = await syncAction('buy_attack', { attackType });
        if (!(buyResponse?.ok || buyResponse?.data?.state)) {
          btn.disabled = false;
          return;
        }
      }
      const attackResponse = await syncAction('attack_boss', { attackType });
      if (!(attackResponse?.ok || attackResponse?.data?.state)) {
        btn.disabled = false;
        return;
      }
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
  const selectedMap = getAdventureMapChoice();
  const mapId = selectedMap.id;
  const routeDefs = adventureRouteDefsForMap(mapId);
  const rewardDefs = adventureRewardMapForMap(mapId);
  const title = document.querySelector('#adventure-screen .battle-screen__head h2');
  if (title) title.textContent = mapAdventureLabel(mapId);
  const mapNodes = (currentState.adventureMaps && currentState.adventureMaps[mapId])
    ? currentState.adventureMaps[mapId]
    : (Array.isArray(currentState.adventure) ? currentState.adventure : []);
  const workingState = { ...currentState, adventure: mapNodes, activeAdventureMapId: mapId };
  const selectedId = selectedAdventureId(workingState);
  const selected = getAdventureNode(workingState, selectedId) || mapNodes[0] || null;
  const selectedIndex = selected ? mapNodes.findIndex((n) => n.id === selected.id) : -1;
  const isSelectedLocked = selected ? isAdventureLocked(workingState, selectedIndex) : false;
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
          <img class="adventure-map__bg" src="${mapId === 'desert' ? '/assets/maps/adventure/desert.png' : (mapId === 'cave' ? '/assets/maps/adventure/cave.png' : '/assets/maps/adventure/map.png')}" alt="Карта приключений">
          <div class="adventure-map__overlay"></div>

          ${mapNodes.map((node) => {
            const defNode = routeDefs.find((item) => item.id === node.id) || routeDefs[0];
            const idx = mapNodes.findIndex((n) => n.id === node.id);
            const locked = isAdventureLocked(workingState, idx);
            const classes = [
              'adventure-node',
              node.completed ? 'is-complete' : '',
              node.id === selectedId ? 'is-active' : '',
              locked ? 'is-locked' : '',
              pendingAdventureShakeId === node.id ? 'is-shaking' : '',
            ].filter(Boolean).join(' ');
            const reward = rewardDefs[idx] || { xp: 0, seeds: 0 };
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
          <p>${isSelectedLocked ? 'Следующая точка пока недоступна.' : 'Выбери точку маршрута.'}</p>
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
            <span>Полные проходы карты</span>
            <strong>${formatAchievementNumber(Math.max(0, Number(currentState.locationPasses) || 0))}</strong>
          </div>
          <div class="stat-box">
            <span>Награда за действие</span>
            <strong>${(() => { const reward = rewardDefs[selectedIndex >= 0 ? selectedIndex : 0] || { xp: 0, seeds: 0 }; return `+${reward.xp} опыта, +${reward.seeds} семечек`; })()}</strong>
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
            ${selected && !selected.completed ? `Пройти за ${selected.energyCost} энергии` : 'Точка пройдена'}
          </button>
          <button type="button" id="btn-adventure-back" class="ghost">Вернуться к сцене</button>
        </div>

        <div class="adventure-note">
          ${selected?.completed
            ? 'Эта точка уже пройдена. Можно посмотреть другие участки карты.'
            : 'Переходи по маршруту.'}
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

function renderBusinessScreen() {
  const body = $('#business-screen-body');
  if (!body) return;

  const level = Number(currentState?.player?.level || 1);
  const unlocked = level >= BUSINESS_UNLOCK_LEVEL;
  const seeds = Math.max(0, Number(currentState?.player?.currency?.seeds) || 0);
  const business = currentState.business || {};
  const latestLog = Array.isArray(currentState.log) && currentState.log.length > 0 ? currentState.log[0] : '';
  const cards = Object.values(BUSINESS_DEFS).map((def) => {
    const currentLevel = Math.max(0, Number(business[`${def.id}Level`] || 0));
    const lastClaimAt = business[`${def.id}LastClaimAt`] || '';
    const nextCost = businessUpgradeCost(def, currentLevel);
    const purchaseCost = def.purchaseCost;
    const cost = currentLevel <= 0 ? purchaseCost : nextCost;
    const canAfford = seeds >= cost;
    const payout = businessRewardAmount(def, Math.max(1, currentLevel || 0));
    const countdown = currentLevel > 0 ? businessNextClaimCountdown(lastClaimAt) : '';
    const maxed = currentLevel >= 100;
    const actionLabel = currentLevel <= 0
      ? `Купить за ${purchaseCost} семечек`
      : (maxed ? 'Максимальный уровень' : `Прокачать за ${nextCost} семечек`);
    const actionDisabled = !unlocked || maxed;
    const subtitle = currentLevel <= 0
      ? 'После покупки доход начнёт приходить каждые 12 часов.'
      : `Приносит ${payout} ${def.rewardLabel} каждые 12 часов.`;
    const timer = currentLevel <= 0
      ? 'Пока не куплено'
      : (countdown ? `Следующая выплата через ${countdown}` : 'Таймер запускается после покупки');
    const fundsHint = currentLevel <= 0
      ? `Нужно ${purchaseCost} семечек${canAfford ? ' • можно купить' : ` • не хватает ${Math.max(0, purchaseCost - seeds)}`}`
      : (maxed ? 'Уровень уже максимальный' : `Нужно ${nextCost} семечек${canAfford ? ' • можно улучшить' : ` • не хватает ${Math.max(0, nextCost - seeds)}`}`);
    return `
      <article class="business-card ${maxed ? 'is-max' : ''}">
        <img class="business-card__img" src="${def.image}" alt="${def.name}" />
        <div class="business-card__body">
          <div class="business-card__head">
            <div>
              <strong>${def.name}</strong>
              <span>${subtitle}</span>
            </div>
            <div class="tag">Уровень ${currentLevel}/100</div>
          </div>
          <div class="business-card__stats">
            <div class="business-stat">
              <span>Доход</span>
              <strong>${payout} ${def.rewardLabel}</strong>
            </div>
            <div class="business-stat">
              <span>Покупка / следующий уровень</span>
              <strong>${actionLabel}</strong>
            </div>
            <div class="business-stat">
              <span>Семечки</span>
              <strong>${fundsHint}</strong>
            </div>
            <div class="business-stat">
              <span>Таймер</span>
              <strong>${timer}</strong>
            </div>
          </div>
          <button type="button" class="primary business-card__action" data-business-action="${def.action}" ${actionDisabled ? 'disabled' : ''}>
            ${actionLabel}
          </button>
        </div>
      </article>
    `;
  }).join('');

  if (!unlocked) {
    body.innerHTML = `
      <div class="business-locked">
        <div class="business-locked__panel">
          <div class="eyebrow">Бизнес недоступен</div>
          <h3>Откроется с ${BUSINESS_UNLOCK_LEVEL} уровня хомяка</h3>
          <p>Пока бизнес закрыт. Как только хомяк достигнет ${BUSINESS_UNLOCK_LEVEL} уровня, здесь появятся магазин и колёсико.</p>
        </div>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    ${latestLog ? `<div class="business-note-banner">${latestLog}</div>` : ''}
    <div class="business-layout">
      ${cards}
    </div>
  `;

  document.querySelectorAll('[data-business-action]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.businessAction;
      if (!action) return;
      btn.disabled = true;
      await syncAction(action, {});
      setView('business');
      render();
    };
  });
}

function renderExchangeScreen() {
  const body = $('#exchange-screen-body');
  if (!body) return;

  const latestLog = Array.isArray(currentState.log) && currentState.log.length > 0 ? currentState.log[0] : '';
  const cards = EXCHANGE_DEFS.map((def) => {
    const available = Math.max(0, Number(currentState?.player?.currency?.[def.from]) || 0) >= 1;
    const fromLabel = CURRENCY_LABELS[def.from] || def.from;
    const toLabel = CURRENCY_LABELS[def.to] || def.to;
    return `
      <button type="button" class="exchange-card ${available ? '' : 'is-locked'}" data-exchange-action="${def.action}" ${available ? '' : 'disabled aria-disabled="true" title="Недостаточно ресурсов"'}>
        <div class="exchange-card__icons" aria-hidden="true">
          <span class="exchange-card__icon-wrap">
            <img class="exchange-card__icon" src="${CURRENCY_ICONS[def.from]}" alt="" />
          </span>
          <span class="exchange-card__arrow">→</span>
          <span class="exchange-card__icon-wrap">
            <img class="exchange-card__icon" src="${CURRENCY_ICONS[def.to]}" alt="" />
          </span>
        </div>
        <div class="exchange-card__text">
          <strong>1 ${fromLabel.toLowerCase()} = ${def.rate} ${toLabel.toLowerCase()}</strong>
          <span>Обмен по фиксированному курсу</span>
        </div>
      </button>
    `;
  }).join('');

  body.innerHTML = `
    ${latestLog ? `<div class="business-note-banner">${latestLog}</div>` : ''}
    <div class="exchange-layout">
      <div class="exchange-panel">
        <div class="eyebrow">Обмен валют</div>
        <h3>Выбери нужный размен</h3>
        <p>Здесь показаны только курсы. Текущие запасы не дублируются, чтобы экран оставался чистым.</p>
        <div class="exchange-grid">
          ${cards}
        </div>
      </div>
      <div class="exchange-mascot">
        <img class="exchange-mascot__img" src="${EXCHANGE_MASCOT_IMAGE}" alt="Хомяк предлагает обмен" />
      </div>
    </div>
  `;

  document.querySelectorAll('[data-exchange-action]').forEach((btn) => {
    btn.onclick = async () => {
      const action = btn.dataset.exchangeAction;
      if (!action) return;
      btn.disabled = true;
      await syncAction(action, {});
      setView('exchange');
      render();
    };
  });
}

function renderAppearanceOptionButton(option, slot) {
  const selected = (currentState.player.appearance?.[slot] || (slot === 'background' ? currentState.player.wallpaper : 'none')) === option.id;
  const thumbStyle = option.color ? `style="--chip-color: ${option.color};"` : '';
  const thumbImage = option.img
    ? `<img class="appearance-option__img ${slot === 'color' ? 'appearance-option__img--hamster' : ''}" src="${option.img}" alt="" />`
    : `<span class="appearance-thumb-fallback">${option.name.slice(0, 2)}</span>`;
  let locked = false;
  if (slot === 'color' && option.id !== 'default') {
    locked = (currentState.player.inventory?.[option.id] || 0) <= 0;
  }
  if (slot === 'headwear' && option.id === 'wreath') {
    locked = (currentState.player.inventory?.['wreath_skin'] || 0) <= 0;
  }
  if (slot === 'heldItem' && option.id === 'stone') {
    locked = (currentState.player.inventory?.['stone_skin'] || 0) <= 0;
  }
  if (slot === 'mask' && option.id === 'cigarette') {
    locked = (currentState.player.inventory?.['cigarette_skin'] || 0) <= 0;
  }
  if (slot === 'headwear' && option.id === 'cap') {
    locked = (currentState.player.inventory?.['cap'] || 0) <= 0;
  }
  if (slot === 'glasses' && option.id === 'glasses_round') {
    locked = (currentState.player.inventory?.['glasses_round'] || 0) <= 0;
  }
  if (slot === 'mask' && option.id === 'scarf') {
    locked = (currentState.player.inventory?.['scarf'] || 0) <= 0;
  }
  if (slot === 'heldItem' && option.id === 'stick') {
    locked = (currentState.player.inventory?.['stick'] || 0) <= 0;
  }
  if (slot === 'body' && option.id === 'camouflage_jacket') {
    locked = (currentState.player.inventory?.['camouflage_jacket'] || 0) <= 0;
  }
  if (slot === 'shoes' && option.id === 'camouflage_sneakers') {
    locked = (currentState.player.inventory?.['camouflage_sneakers'] || 0) <= 0;
  }
  if (slot === 'heldItem' && option.id === 'prize') {
    locked = (currentState.player.inventory?.['prize_skin'] || 0) <= 0;
  }
  if (slot === 'headwear' && option.id === 'festive_cap') {
    locked = (currentState.player.inventory?.['festive_cap_skin'] || 0) <= 0;
  }
  if (slot === 'mask' && option.id === 'festive_tiugue') {
    locked = (currentState.player.inventory?.['festive_tiugue_skin'] || 0) <= 0;
  }
  if (slot === 'body' && option.id === 't-shirt') {
    locked = (currentState.player.inventory?.['t-shirt_skin'] || 0) <= 0;
  }
  if (slot === 'shoes' && option.id === 'vans') {
    locked = (currentState.player.inventory?.['vans_skin'] || 0) <= 0;
  }
  if (slot === 'heldItem' && option.id === 'adjustable_wrench') {
    locked = (currentState.player.inventory?.['adjustable_wrench'] || 0) <= 0;
  }
  if (slot === 'heldItem' && option.id === 'cleaver') {
    locked = (currentState.player.inventory?.['cleaver'] || 0) <= 0;
  }
  if (slot === 'body' && option.id === 'mehanic_costume') {
    locked = (currentState.player.inventory?.['mehanic_costume'] || 0) <= 0;
  }
  if (slot === 'body' && option.id === 'meat_apron') {
    locked = (currentState.player.inventory?.['meat_apron'] || 0) <= 0;
  }
  if (slot === 'headwear' && option.id === 'mehanic_cup') {
    locked = (currentState.player.inventory?.['mehanic_cup'] || 0) <= 0;
  }
  if (slot === 'headwear' && option.id === 'meat_cup') {
    locked = (currentState.player.inventory?.['meat_cup'] || 0) <= 0;
  }
  if (slot === 'mask' && option.id === 'mustache') {
    locked = (currentState.player.inventory?.['mustache'] || 0) <= 0;
  }
  if (slot === 'shoes' && option.id === 'mehanic_but') {
    locked = (currentState.player.inventory?.['mehanic_but'] || 0) <= 0;
  }
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
          <div class="edit-preview__hamster" style="--hamster-scale: ${getHamsterScale(currentState.player.appearance?.size || 'normal', currentState.player.appearance?.color || 'default')};">
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
            <h3>${activeSlot.id === 'background' ? 'Выбор фона' : activeSlot.id === 'size' ? 'Выбор размера' : 'Выбор предмета'}</h3>
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
  const totalAchievements = countUnlockedAchievements(currentState);
  const expectedBoxes = Math.floor(totalAchievements / 8);
  const claimed = currentState.player.boxesClaimed || 0;
  if (expectedBoxes > claimed) {
    currentState.player.boxCount = (currentState.player.boxCount || 0) + (expectedBoxes - claimed);
    currentState.player.boxesClaimed = expectedBoxes;
  }
  currentState = advanceLocalBusiness(currentState);
  if (!currentState.activeBossId) {
    currentState = advanceLocalEnergy(currentState);
  }
  $('#player-name-input').value = currentState.player.name || 'Хомяк';
  const authTitle = $('#auth-title');
  if (authTitle) {
    authTitle.textContent = isAuthenticated ? `Добро пожаловать, ${currentUserLogin || currentState.player.name || 'хомяк'}` : 'Вход в игру';
  }
  document.body.classList.toggle('is-authenticated', isAuthenticated);
  document.body.classList.toggle('is-guest', !isAuthenticated);
  renderResourceStrip(currentState);
  const businessPanelButton = $('#btn-business-panel');
  if (businessPanelButton) {
    const playerLevel = Math.max(1, Number(currentState?.player?.level) || 1);
    businessPanelButton.disabled = playerLevel < BUSINESS_UNLOCK_LEVEL;
    businessPanelButton.title = businessPanelButton.disabled
      ? `Откроется с ${BUSINESS_UNLOCK_LEVEL} уровня`
      : 'Открыть бизнес';
  }
  const exchangePanelButton = $('#btn-exchange-panel');
  if (exchangePanelButton) {
    exchangePanelButton.title = 'Открыть обменник';
  }
  const coinPanelButton = $('#btn-coin-panel');
  if (coinPanelButton) {
    const playerLevel = Math.max(1, Number(currentState?.player?.level) || 1);
    coinPanelButton.hidden = !isAuthenticated;
    coinPanelButton.disabled = playerLevel < COIN_GAME_UNLOCK_LEVEL;
    coinPanelButton.title = coinPanelButton.disabled
      ? `Откроется с ${COIN_GAME_UNLOCK_LEVEL} уровня`
      : 'Открыть монетку';
  }
  const skinshopPanelButton = $('#btn-skinshop-panel');
  if (skinshopPanelButton) {
    const playerLevel = Math.max(1, Number(currentState?.player?.level) || 1);
    skinshopPanelButton.disabled = playerLevel < SKIN_SHOP_UNLOCK_LEVEL;
    skinshopPanelButton.title = skinshopPanelButton.disabled
      ? `Откроется с ${SKIN_SHOP_UNLOCK_LEVEL} уровня`
      : 'Открыть магазин скинов';
  }
  updateScene(currentState);
  updateFriendsBadge();
  if (isAuthenticated) {
    void refreshFriendsBadge();
  }
  if (document.getElementById('profile-modal')) {
    if (profileModalProfile) {
      renderProfileModal(profileModalProfile);
    } else if (profileModalLoading || profileModalTarget || profileModalError) {
      renderProfileModal(null);
    }
  }
  if (document.getElementById('friends-modal') && !document.getElementById('friends-modal').hidden) {
    renderFriendsModal();
  }
  if (document.getElementById('achievements-modal')) {
    renderAchievementsModal();
  }
  const leaderboardsHome = document.getElementById('leaderboard-home-body');
  if (leaderboardsHome) {
    leaderboardsHome.innerHTML = renderHomeLeaderboards();
    bindLeaderboardEvents();
    if (!leaderboardsData || Date.now() - leaderboardsLoadedAt > LEADERBOARD_REFRESH_MS) {
      void loadLeaderboards();
    }
  }
  if (isAuthenticated && (!socialSnapshotProfile || Date.now() - socialSnapshotLoadedAt > SOCIAL_SNAPSHOT_REFRESH_MS)) {
    void loadSocialSnapshot();
  }

  const auth = $('#auth-screen');
  const main = $('#main-screen');
  const battle = $('#battle-screen');
  const adventureSelect = $('#adventure-select-screen');
  const adventure = $('#adventure-screen');
  const business = $('#business-screen');
  const exchange = $('#exchange-screen');
  const coin = $('#coin-screen');
  const edit = $('#edit-screen');
  const talents = $('#talents-screen');
  const skinshop = $('#skinshop-screen');

  if (auth) auth.hidden = isAuthenticated;
  if (!isAuthenticated) {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    const coinPanelButton = $('#btn-coin-panel');
    if (coinPanelButton) coinPanelButton.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    if (skinshop) skinshop.hidden = true;
    return;
  }

  if (skinshop) skinshop.hidden = true;

  if (view === 'battle') {
    main.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    const lootbox = $('#lootbox-screen');
    if (lootbox) lootbox.hidden = true;
    battle.hidden = false;
    renderBattleScreen();
  } else if (view === 'adventure-select') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    adventureSelect.hidden = false;
    renderAdventureMapSelectScreen();
  } else if (view === 'adventure') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    adventure.hidden = false;
    renderAdventureScreen();
  } else if (view === 'business') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    business.hidden = false;
    renderBusinessScreen();
  } else if (view === 'exchange') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    exchange.hidden = false;
    renderExchangeScreen();
  } else if (view === 'coin') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    coin.hidden = false;
    renderCoinScreen();
  } else if (view === 'edit') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    if (talents) talents.hidden = true;
    edit.hidden = false;
    renderEditScreen();
  } else if (view === 'talents') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = false;
    const lootbox = $('#lootbox-screen');
    if (lootbox) lootbox.hidden = true;
    renderTalentsScreen();
  } else if (view === 'lootbox') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    const lootbox = $('#lootbox-screen');
    if (lootbox) lootbox.hidden = false;
    if (lootBoxUI.phase === 'ready') {
      renderLootBoxScreen();
    }
  } else if (view === 'skinshop') {
    main.hidden = true;
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    const lootbox = $('#lootbox-screen');
    if (lootbox) lootbox.hidden = true;
    if (skinshop) skinshop.hidden = false;
    renderSkinShopScreen();
  } else {
    battle.hidden = true;
    adventureSelect.hidden = true;
    adventure.hidden = true;
    business.hidden = true;
    exchange.hidden = true;
    if (coin) coin.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    const lootbox = $('#lootbox-screen');
    if (lootbox) lootbox.hidden = true;
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

  const newGameButton = $('#btn-new');
  if (newGameButton) {
    newGameButton.onclick = async () => {
      currentState = normalizeState(DEFAULT_STATE);
      setView('main');
      await syncAction('new_run', {});
      render();
    };
  }

  const profileButton = $('#btn-profile');
  if (profileButton) {
    profileButton.onclick = () => {
      openProfileModal(currentUserLogin || currentState?.player?.name || '');
    };
  }

  const friendsButton = $('#btn-friends');
  if (friendsButton) {
    friendsButton.onclick = () => {
      openFriendsModal();
    };
  }

  const achievementsButton = $('#btn-achievements');
  if (achievementsButton) {
    achievementsButton.onclick = () => {
      openAchievementsModal();
    };
  }

  const talentsButton = $('#btn-talents');
  if (talentsButton) {
    talentsButton.onclick = () => {
      setView('talents');
      render();
    };
  }

  const battlePanelButton = $('#btn-battle-panel');
  if (battlePanelButton) {
    battlePanelButton.onclick = () => {
      setView('battle');
      render();
    };
  }

  const mapPanelButton = $('#btn-map-panel');
  if (mapPanelButton) {
    mapPanelButton.onclick = () => {
      setView('adventure-select');
      render();
    };
  }

  const adventureSelectBackButton = $('#btn-adventure-select-back');
  if (adventureSelectBackButton) {
    adventureSelectBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const businessBackButton = $('#btn-business-back');
  if (businessBackButton) {
    businessBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const exchangeBackButton = $('#btn-exchange-back');
  if (exchangeBackButton) {
    exchangeBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const coinBackButton = $('#btn-coin-back');
  if (coinBackButton) {
    coinBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const talentsBackButton = $('#btn-talents-back');
  if (talentsBackButton) {
    talentsBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const lootboxBackButton = $('#btn-lootbox-back');
  if (lootboxBackButton) {
    lootboxBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const skinshopBackButton = $('#btn-skinshop-back');
  if (skinshopBackButton) {
    skinshopBackButton.onclick = () => {
      setView('main');
      render();
    };
  }

  const businessPanelButton = $('#btn-business-panel');
  if (businessPanelButton) {
    businessPanelButton.disabled = Number(currentState?.player?.level || 1) < BUSINESS_UNLOCK_LEVEL;
    businessPanelButton.onclick = () => {
      if (businessPanelButton.disabled) return;
      setView('business');
      render();
    };
  }

  const exchangePanelButton = $('#btn-exchange-panel');
  if (exchangePanelButton) {
    exchangePanelButton.onclick = () => {
      setView('exchange');
      render();
    };
  }

  const coinPanelButton = $('#btn-coin-panel');
  if (coinPanelButton) {
    coinPanelButton.onclick = () => {
      if (coinPanelButton.disabled) return;
      setView('coin');
      render();
    };
  }

  const talentsPanelButton = $('#btn-talents-panel');
  if (talentsPanelButton) {
    talentsPanelButton.onclick = () => {
      setView('talents');
      render();
    };
  }

  const lootboxPanelButton = $('#btn-lootbox-panel');
  if (lootboxPanelButton) {
    lootboxPanelButton.onclick = () => {
      setView('lootbox');
      render();
    };
  }

  const skinshopPanelButton = $('#btn-skinshop-panel');
  if (skinshopPanelButton) {
    skinshopPanelButton.disabled = Number(currentState?.player?.level || 1) < SKIN_SHOP_UNLOCK_LEVEL;
    skinshopPanelButton.onclick = () => {
      if (skinshopPanelButton.disabled) return;
      setView('skinshop');
      render();
    };
  }
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



function coinGameAccessAllowed() {
  return Math.max(1, Number(currentState?.player?.level) || 1) >= COIN_GAME_UNLOCK_LEVEL;
}

function coinGameLevel() {
  return Math.max(1, Number(currentState?.player?.coinLevel) || 1);
}

function coinGameXP() {
  return Math.max(0, Number(currentState?.player?.coinXP) || 0);
}

function coinGameChoiceLabel(choice) {
  return choice === 'mouse' ? 'мышь' : 'хомяк';
}

function coinGameOutcomeAsset(rolled) {
  return rolled === 'mouse' ? COIN_GAME_ART.mouse : COIN_GAME_ART.hamster;
}

function resetCoinGameUI() {
  if (coinGameUI.videoFallback) {
    window.clearTimeout(coinGameUI.videoFallback);
  }
  coinGameUI = {
    phase: 'ready',
    choice: '',
    pendingChoice: '',
    result: null,
    message: '',
    videoToken: 0,
    videoFallback: null,
  };
}

function coinGameResultFromState() {
  const player = currentState?.player || {};
  if (!player.coinLastChoice && !player.coinLastRolled && !player.coinLastMessage) return null;
  return {
    choice: player.coinLastChoice || '',
    rolled: player.coinLastRolled || '',
    won: Boolean(player.coinLastWon),
    message: player.coinLastMessage || '',
  };
}

function renderCoinScreen() {
  const title = $('#coin-screen .battle-screen__head h2');
  const subtitle = $('#coin-screen .battle-screen__head p');
  if (title) title.textContent = 'Монетка удачи';
  if (subtitle) subtitle.textContent = 'Цена игры — 1 морковка. Выбирай номинал, смотри ролик и забирай награду.';
  const body = $('#coin-screen-body');
  if (!body) return;

  const level = coinGameLevel();
  const xp = coinGameXP();
  const playerLevel = Math.max(1, Number(currentState?.player?.level) || 1);
  const carrots = Math.max(0, Number(currentState?.player?.currency?.carrot) || 0);
  const unlocked = coinGameAccessAllowed();
  const canStart = unlocked && carrots >= COIN_GAME_COST_CARROTS;
  const result = coinGameUI.result || coinGameResultFromState();

  if (coinGameUI.phase === 'playing') {
    const existingVideo = document.getElementById('coin-game-video');
    if (existingVideo) {
      return;
    }
    body.innerHTML = `
      <div class="coin-video">
        <div class="coin-video__frame">
          <video id="coin-game-video" src="${COIN_GAME_ART.video}" autoplay muted playsinline preload="auto" poster="${COIN_GAME_ART.intro}"></video>
        </div>
        <div class="coin-lock">Проверяем удачу и подводим итог...</div>
      </div>
    `;
    const video = document.getElementById('coin-game-video');
    if (video) {
      const finish = () => {
        if (coinGameUI.phase !== 'playing') return;
        if (coinGameUI.videoFallback) {
          window.clearTimeout(coinGameUI.videoFallback);
          coinGameUI.videoFallback = null;
        }
        coinGameUI.phase = 'result';
        render();
      };
      video.onended = finish;
      video.onerror = finish;
      video.onloadeddata = () => {
        video.play().catch(() => {});
      };
      video.play().catch(() => {});
      if (coinGameUI.videoFallback) {
        window.clearTimeout(coinGameUI.videoFallback);
        coinGameUI.videoFallback = null;
      }
      coinGameUI.videoFallback = window.setTimeout(finish, 3000);
    }
    return;
  }

  if (coinGameUI.phase === 'choose') {
    body.innerHTML = `
      <div class="coin-choice">
        <div class="profile-section__head">
          <strong>Выбери номинал</strong>
          <span>Шанс выпадения: 50% на 50%</span>
        </div>
        <div class="coin-choice-grid">
          <button type="button" class="coin-choice__card" data-coin-choice="hamster">
            <div class="coin-choice__image"><img src="${COIN_GAME_ART.hamster}" alt="Хомяк" /></div>
            <strong>Хомяк</strong>
            <span>Выбрать этот номинал</span>
          </button>
          <button type="button" class="coin-choice__card" data-coin-choice="mouse">
            <div class="coin-choice__image"><img src="${COIN_GAME_ART.mouse}" alt="Мышь" /></div>
            <strong>Мышь</strong>
            <span>Выбрать этот номинал</span>
          </button>
        </div>
        <div class="coin-actions">
          <button id="btn-coin-cancel" class="ghost" type="button">Отмена</button>
        </div>
      </div>
    `;
    document.querySelectorAll('[data-coin-choice]').forEach((btn) => {
      btn.onclick = () => startCoinRound(btn.dataset.coinChoice || 'hamster');
    });
    const cancelBtn = document.getElementById('btn-coin-cancel');
    if (cancelBtn) {
      cancelBtn.onclick = () => {
        coinGameUI.phase = 'ready';
        coinGameUI.message = '';
        coinGameUI.pendingChoice = '';
        coinGameUI.result = null;
        render();
      };
    }
    return;
  }

  if (coinGameUI.phase === 'result' && (result || coinGameUI.message)) {
    const won = Boolean(result?.won);
    const rolled = result?.rolled || 'hamster';
    const choice = result?.choice || coinGameUI.pendingChoice || '';
    const rewardText = won
      ? 'Победа: +150 опыта хомяка, +300 семечек и +3 пшеницы. Монетка получает +2 опыта.'
      : 'Поражение: +1 опыта монетки.';
    body.innerHTML = `
      <div class="coin-result ${won ? 'is-win' : 'is-lose'}">
        <div class="coin-result__image">
          <img src="${coinGameOutcomeAsset(rolled)}" alt="${coinGameChoiceLabel(rolled)}" />
        </div>
        <div class="coin-result__info">
          <div class="profile-section__head">
            <strong>${won ? 'Победа' : 'Поражение'}</strong>
            <span>Выпало: ${coinGameChoiceLabel(rolled)}</span>
          </div>
          <p>Твой выбор: ${coinGameChoiceLabel(choice)}.</p>
          <p>${rewardText}</p>
          ${result?.message ? `<div class="coin-lock">${result.message}</div>` : ''}
          <div class="coin-stats">
            <div class="coin-stat"><span>Монетка</span><strong>ур. ${level} • ${xp}/10</strong></div>
            <div class="coin-stat"><span>Хомяк</span><strong>ур. ${playerLevel}</strong></div>
            <div class="coin-stat"><span>Морковь</span><strong>${carrots}</strong></div>
          </div>
          <div class="coin-result__actions">
            <button id="btn-coin-again" class="primary" type="button" ${canStart ? '' : 'disabled'}>Сыграть ещё</button>
            <button id="btn-coin-reset" class="ghost" type="button">К выбору</button>
          </div>
        </div>
      </div>
    `;
    const again = document.getElementById('btn-coin-again');
    if (again) {
      again.onclick = () => {
        coinGameUI.phase = 'choose';
        coinGameUI.message = '';
        coinGameUI.result = null;
        coinGameUI.pendingChoice = '';
        render();
      };
    }
    const reset = document.getElementById('btn-coin-reset');
    if (reset) {
      reset.onclick = () => {
        resetCoinGameUI();
        render();
      };
    }
    return;
  }

  body.innerHTML = `
    <div class="coin-layout">
      <section class="coin-hero">
        <div class="coin-hero__image">
          <img src="${COIN_GAME_ART.intro}" alt="Монетка удачи" />
        </div>
        <div class="coin-hero__meta">
          <strong>Монетка</strong>
          <p>Монетка с двумя номиналами: хомяк и мышь. Разыгрывай 1 морковку и получай награды за удачу.</p>
        </div>
      </section>
      <section class="coin-panel">
        <div class="coin-stats">
          <div class="coin-stat"><span>Доступ</span><strong>${unlocked ? 'Открыто' : `С ${COIN_GAME_UNLOCK_LEVEL} уровня`}</strong></div>
          <div class="coin-stat"><span>Цена игры</span><strong>1 морковь</strong></div>
          <div class="coin-stat"><span>Монетка</span><strong>ур. ${level}</strong></div>
          <div class="coin-stat"><span>Опыт монетки</span><strong>${xp}/10</strong></div>
        </div>
        <p>${unlocked ? (canStart ? 'Нажимай «Сыграть» и выбирай номинал.' : 'Нужна ещё 1 морковка, чтобы сыграть.') : 'Монетка открывается только с 6 уровня хомяка.'}</p>
        ${coinGameUI.message ? `<div class="coin-lock">${coinGameUI.message}</div>` : ''}
        <div class="coin-actions">
          <button id="btn-coin-play" class="primary" type="button" ${canStart ? '' : 'disabled'}>Сыграть</button>
          <button id="btn-coin-clear" class="ghost" type="button">Сбросить</button>
        </div>
      </section>
    </div>
  `;
  const playBtn = document.getElementById('btn-coin-play');
  if (playBtn) {
    playBtn.onclick = () => {
      if (!canStart) return;
      coinGameUI.phase = 'choose';
      coinGameUI.message = '';
      coinGameUI.result = null;
      coinGameUI.pendingChoice = '';
      render();
    };
  }
  const clearBtn = document.getElementById('btn-coin-clear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      resetCoinGameUI();
      render();
    };
  }
}

function resetLootBoxUI() {
  lootBoxUI = { phase: 'ready', message: '' };
}

const LOOTBOX_ART = {
  menu: '/assets/box/menu.png',
  video: '/assets/box/open_box.mp4',
  open: '/assets/box/open.png',
};

function renderLootBoxScreen() {
  const title = $('#lootbox-screen .battle-screen__head h2');
  const subtitle = $('#lootbox-screen .battle-screen__head p');
  if (title) title.textContent = 'Лут Бокс';
  if (subtitle) subtitle.textContent = 'Открывай боксы и получай награды за достижения.';
  const body = $('#lootbox-screen-body');
  if (!body) return;

  const boxCount = currentState.player.boxCount || 0;
  const achievements = countUnlockedAchievements(currentState);
  const nextBoxAt = (Math.floor(achievements / 8) + 1) * 8;
  const progressToNext = achievements % 8;

  body.innerHTML = `
    <div class="lootbox-layout">
      <section class="lootbox-hero">
        <div class="lootbox-hero__image">
          <img src="${LOOTBOX_ART.menu}" alt="Лут Бокс" />
        </div>
        <div class="lootbox-hero__meta">
          <strong>Лут Бокс</strong>
          <p>Каждые 8 достижений дают 1 бокс. Открывай боксы и получай ресурсы, атаки и скины!</p>
        </div>
      </section>
      <section class="lootbox-panel">
        <div class="lootbox-stats">
          <div class="coin-stat"><span>Боксов</span><strong>${boxCount}</strong></div>
          <div class="coin-stat"><span>Достижений</span><strong>${achievements}</strong></div>
          <div class="coin-stat"><span>Следующий бокс через</span><strong>${nextBoxAt - achievements} достижений</strong></div>
        </div>
        <div class="progress-bar"><div style="width: ${(progressToNext / 8) * 100}%"></div></div>
        <p>${boxCount > 0 ? 'Нажимай «Открыть» и забирай награду.' : 'Пока боксов нет. Получай достижения!'}</p>
        ${lootBoxUI.message ? `<div class="coin-lock">${lootBoxUI.message}</div>` : ''}
        <div class="coin-actions">
          <button id="btn-lootbox-open" class="primary" type="button">Открыть бокс</button>
        </div>
      </section>
    </div>
  `;
  const openBtn = document.getElementById('btn-lootbox-open');
  if (openBtn) {
    openBtn.onclick = () => openLootBox();
  }
}

function showLootBoxRewards(rewards) {
  const body = $('#lootbox-screen-body');
  if (!body) return;
  const boxCount = currentState.player.boxCount || 0;
  body.innerHTML = `
    <div class="lootbox-result">
      <div class="lootbox-result__image">
        <img src="${LOOTBOX_ART.open}" alt="Бокс открыт" />
      </div>
      <div class="lootbox-result__info">
        <div class="profile-section__head">
          <strong>Бокс открыт!</strong>
          <span>Полученные награды</span>
        </div>
        <div class="lootbox-rewards">
          ${rewards.map((r) => `
            <div class="lootbox-reward-item">
              <strong>${r}</strong>
            </div>
          `).join('')}
        </div>
        <div class="coin-result__actions">
          <button id="btn-lootbox-again" class="primary" type="button" ${boxCount > 0 ? '' : 'disabled'}>Открыть ещё</button>
          <button id="btn-lootbox-reset" class="ghost" type="button">Назад</button>
        </div>
      </div>
    </div>
  `;
  const again = document.getElementById('btn-lootbox-again');
  if (again) {
    again.onclick = () => {
      resetLootBoxUI();
      openLootBox();
    };
  }
  const reset = document.getElementById('btn-lootbox-reset');
  if (reset) {
    reset.onclick = () => {
      resetLootBoxUI();
      render();
    };
  }
}

function renderSkinShopScreen() {
  const body = $('#skinshop-screen-body');
  if (!body) return;

  const seeds = Math.max(0, Number(currentState?.player?.currency?.seeds) || 0);
  const cucumbers = Math.max(0, Number(currentState?.player?.currency?.cucumber) || 0);
  const inventory = currentState?.player?.inventory || {};
  const shopItems = currentState?.skinShopItems || [];
  const lastRefresh = currentState?.skinShopLastRefreshAt || '';

  let refreshCountdown = '';
  if (lastRefresh) {
    const elapsed = Date.now() - new Date(lastRefresh).getTime();
    const remaining = SKIN_SHOP_REFRESH_MS - elapsed;
    if (remaining > 0) {
      const hours = Math.floor(remaining / 3600000);
      const mins = Math.floor((remaining % 3600000) / 60000);
      refreshCountdown = `${hours}ч ${mins}м`;
    }
  }

  const itemsHtml = shopItems.map((itemId) => {
    const item = SKIN_SHOP_ITEMS[itemId];
    if (!item) return '';
    const owned = (inventory[itemId] || 0) > 0;
    const canAfford = seeds >= item.price;
    return `
      <div class="skinshop-card ${owned ? 'is-owned' : ''}">
        <img class="skinshop-card__img" src="${item.img}" alt="${item.name}" />
        <div class="skinshop-card__body">
          <strong>${item.name}</strong>
          <span>${owned ? 'Куплено' : `${item.price} семечек`}</span>
          ${!owned ? `<button class="primary skinshop-buy-btn" data-skin-id="${itemId}" ${!canAfford ? 'disabled' : ''}>Купить</button>` : ''}
        </div>
      </div>
    `;
  }).join('');

  const setsHtml = SKIN_SHOP_SETS.map((setDef) => {
    const allOwned = setDef.items.every((id) => (inventory[id] || 0) > 0);
    const ownedCount = setDef.items.filter((id) => (inventory[id] || 0) > 0).length;
    const itemsList = setDef.items.map((id) => {
      const item = SKIN_SHOP_ITEMS[id];
      const owned = (inventory[id] || 0) > 0;
      return `<span class="skinshop-set-item ${owned ? 'is-owned' : ''}">${item ? item.name : id}</span>`;
    }).join('');
    return `
      <div class="skinshop-set ${allOwned ? 'is-complete' : ''}">
        <div class="skinshop-set__head">
          <strong>${setDef.name}</strong>
          <span>${ownedCount}/${setDef.items.length}</span>
        </div>
        <div class="skinshop-set__items">${itemsList}</div>
        <div class="skinshop-set__bonuses">
          ${allOwned ? '<span class="skinshop-set__bonus-active">Бонус активен!</span>' : ''}
          ${setDef.bonuses.map((b) => `<span>${b}</span>`).join('')}
        </div>
      </div>
    `;
  }).join('');

  body.innerHTML = `
    <div class="skinshop-layout">
      <section class="skinshop-hero">
        <img class="skinshop-hero__img" src="/assets/shop/menu.png" alt="Продавец" />
      </section>
      <section class="skinshop-panel">
        <div class="skinshop-stats">
          <div class="coin-stat"><span>Семечки</span><strong>${formatAchievementNumber(seeds)}</strong></div>
          <div class="coin-stat"><span>Огурцы</span><strong>${formatAchievementNumber(cucumbers)}</strong></div>
        </div>
        <div class="skinshop-refresh">
          <span>Обновление через: ${refreshCountdown || 'скоро'}</span>
          <button id="btn-skinshop-refresh" class="ghost" type="button" ${cucumbers < 1 ? 'disabled' : ''}>Обновить за 1 огурец</button>
        </div>
        <div class="skinshop-items">${itemsHtml || '<div class="social-note">Магазин пуст. Обновите позже.</div>'}</div>
        <div class="skinshop-sets">
          <h3>Наборы скинов</h3>
          ${setsHtml}
        </div>
      </section>
    </div>
  `;

  body.querySelectorAll('.skinshop-buy-btn').forEach((btn) => {
    btn.onclick = async () => {
      const skinId = btn.getAttribute('data-skin-id');
      if (!skinId) return;
      btn.disabled = true;
      const response = await syncAction('buy_skin_shop_item', { itemId: skinId });
      if (response && response.ok) {
        render();
      } else {
        btn.disabled = false;
      }
    };
  });

  const refreshBtn = document.getElementById('btn-skinshop-refresh');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      refreshBtn.disabled = true;
      const response = await syncAction('refresh_skin_shop', {});
      if (response && response.ok) {
        render();
      } else {
        refreshBtn.disabled = false;
      }
    };
  }
}

async function openLootBox() {
  const body = $('#lootbox-screen-body');
  if (!body) return;

  lootBoxUI.phase = 'playing';
  body.innerHTML = `
    <div class="lootbox-video-wrap" style="text-align:center;">
      <video id="lootbox-video" src="${LOOTBOX_ART.video}" autoplay muted playsinline
        style="max-width:100%;max-height:60vh;border-radius:12px;"></video>
    </div>`;

  const responsePromise = fetch(apiUrl('/action'), {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ action: 'open_lootbox' }),
  });

  const video = document.getElementById('lootbox-video');
  if (video) {
    video.play().catch(() => {});
    await new Promise((resolve) => {
      video.onended = resolve;
      video.onerror = resolve;
    });
  }

  const data = await responsePromise.then((r) => r.json().catch(() => null));

  if (data && data.state) {
    currentState = normalizeState(data.state);
  }

  if (!data || !data.ok) {
    const errMsg = data?.error || 'Не удалось открыть бокс.';
    body.innerHTML = `
      <div class="lootbox-layout">
        <section class="lootbox-panel" style="text-align:center;">
          <div class="coin-lock">${errMsg}</div>
          <div style="margin-top:16px;">
            <button id="btn-lootbox-back-btn" class="ghost" type="button">Назад</button>
          </div>
        </section>
      </div>`;
    const backBtn = document.getElementById('btn-lootbox-back-btn');
    if (backBtn) backBtn.onclick = () => { lootBoxUI.phase = 'ready'; render(); };
    return;
  }

  let rewards = data.state?.player?.lastLootBoxRewards || [];
  if (rewards.length === 0 && Array.isArray(currentState.log) && currentState.log.length > 0) {
    const lastLog = currentState.log[0] || '';
    const m = lastLog.match(/Награда: (.+)\./);
    if (m && m[1]) {
      rewards = m[1].split(', ').map((s) => s.trim()).filter(Boolean);
    }
  }
  if (rewards.length === 0) rewards = ['Бокс открыт!'];

  lootBoxUI.phase = 'result';
  showLootBoxRewards(rewards);
}

function showLootBoxRewards(rewards) {
  const body = $('#lootbox-screen-body');
  if (!body) return;
  const boxCount = currentState.player.boxCount || 0;
  body.innerHTML = `
    <div class="lootbox-result">
      <div class="lootbox-result__image">
        <img src="${LOOTBOX_ART.open}" alt="Бокс открыт" />
      </div>
      <div class="lootbox-result__info">
        <div class="profile-section__head">
          <strong>Бокс открыт!</strong>
          <span>Полученные награды</span>
        </div>
        <div class="lootbox-rewards">
          ${rewards.map((r) => `
            <div class="lootbox-reward-item">
              <strong>${r}</strong>
            </div>
          `).join('')}
        </div>
        <div class="coin-result__actions">
          <button id="btn-lootbox-again" class="primary" type="button" ${boxCount > 0 ? '' : 'disabled'}>Открыть ещё</button>
          <button id="btn-lootbox-reset" class="ghost" type="button">Назад</button>
        </div>
      </div>
    </div>
  `;
  const again = document.getElementById('btn-lootbox-again');
  if (again) {
    again.onclick = () => {
      resetLootBoxUI();
      openLootBox();
    };
  }
  const reset = document.getElementById('btn-lootbox-reset');
  if (reset) {
    reset.onclick = () => {
      resetLootBoxUI();
      render();
    };
  }
}

async function startCoinRound(choice) {
  if (!coinGameAccessAllowed()) {
    coinGameUI.message = `Монетка открывается с ${COIN_GAME_UNLOCK_LEVEL} уровня.`;
    coinGameUI.phase = 'ready';
    render();
    return;
  }
  coinGameUI.phase = 'playing';
  coinGameUI.pendingChoice = choice === 'mouse' ? 'mouse' : 'hamster';
  coinGameUI.result = null;
  coinGameUI.message = '';
  render();
  const response = await syncAction('play_coin_game', { value: coinGameUI.pendingChoice });
  if (!response?.ok && !response?.data?.state) {
    coinGameUI.phase = 'choose';
    coinGameUI.message = response?.data?.error || response?.error || 'Не удалось запустить игру.';
    coinGameUI.result = null;
    render();
    return;
  }
  coinGameUI.result = coinGameResultFromState();
  coinGameUI.phase = 'playing';
  render();
}

async function submitTelegramAuth() {
  const authError = $('#auth-error');
  if (authError) authError.textContent = '';

  const tg = window.Telegram && window.Telegram.WebApp;
  const initData = tg && tg.initData;
  if (!initData) {
    if (authError) authError.textContent = 'Откройте приложение через Telegram';
    return;
  }

  const response = await api('/auth/telegram', { initData });
  if (response.ok && response.data && response.data.token && response.data.state) {
    setAuthToken(response.data.token);
    currentState = normalizeState(response.data.state);
    currentUserLogin = response.data.user || '';
    isAuthenticated = true;
    restoreViewFromState(currentState);
    if (!currentState.activeBossId) setView('main');
    void refreshFriendsBadge(true);
    render();
    return;
  }

  const message = response.data && response.data.error ? response.data.error : 'Не удалось войти';
  if (authError) authError.textContent = message;
}

function initAuthButtons() {
  const telegramBtn = $('#btn-auth-telegram');
  const logoutBtn = $('#btn-logout');
  if (telegramBtn) telegramBtn.onclick = () => submitTelegramAuth();
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      await api('/auth/logout', {}, 'POST');
      setAuthToken('');
      isAuthenticated = false;
      currentUserLogin = '';
      friendsBadgeCount = 0;
      friendsBadgeLastLoadedAt = 0;
      friendsModalProfile = null;
      friendsModalLoading = false;
      friendsModalError = '';
      profileModalProfile = null;
      profileModalLoading = false;
      profileModalError = '';
      const friendsModal = document.getElementById('friends-modal');
      if (friendsModal) friendsModal.hidden = true;
      const profileModal = document.getElementById('profile-modal');
      if (profileModal) profileModal.hidden = true;
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
  initPanelButtons();
  setupSocialPolling();
  render();
  await loadState();

  if (!uiTicker) {
    uiTicker = window.setInterval(() => {
      currentState = advanceLocalBusiness(currentState);
      if (!currentState.activeBossId) {
        currentState = advanceLocalEnergy(currentState);
      }
      render();
    }, 1000);
  }
});