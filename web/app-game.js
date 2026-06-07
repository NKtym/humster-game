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
    case 'select_talent_class': {
      const classId = String(payload.value ?? payload.classId ?? '').trim();
      if (!classId) return;
      if (currentState.player.talentClass && currentState.player.talentClass !== classId) return;
      currentState.player.talentClass = classId;
      return;
    }
    case 'buy_talent': {
      const skillId = String(payload.slot ?? payload.skillId ?? '').trim();
      if (!skillId) return;
      const skill = typeof getTalentSkillDefinition === 'function' ? getTalentSkillDefinition(skillId) : null;
      if (!skill || skill.wip) return;
      if (currentState.player.talentClass && skill.classId && currentState.player.talentClass !== skill.classId) return;
      if (!currentState.player.talents || typeof currentState.player.talents !== 'object') {
        currentState.player.talents = {};
      }
      const currentRank = Number(currentState.player.talents[skillId] || 0);
      if (currentState.player.talentPoints <= 0 || currentRank >= 10) return;
      currentState.player.talents[skillId] = currentRank + 1;
      currentState.player.talentPoints -= 1;
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
  $('#battle-screen-subtitle').textContent = 'Нажми на босса для боя.';
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

  $('#battle-screen-title').textContent = `Бой: ${activeBoss.name}`;
  const battleRemaining = activeBoss.defeated ? '' : bossBattleCountdown(activeBoss);
  $('#battle-screen-subtitle').textContent = activeBoss.defeated
    ? activeBoss.killsToday >= BOSS_KILL_LIMIT ? 'Дневной лимит этого босса исчерпан.' : `Босс уже побеждён. Можно пройти ещё раз. Осталось ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT} попыток на сегодня.`
    : `Битва закончится через ${battleRemaining}. На этом боссе сегодня осталось: ${bossDailyRemaining(activeBoss)}/${BOSS_KILL_LIMIT}.`;

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
          <img class="adventure-map__bg" src="/assets/maps/adventure/map.png" alt="Карта приключений">
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
  const adventure = $('#adventure-screen');
  const edit = $('#edit-screen');
  const talents = $('#talents-screen');

  if (auth) auth.hidden = isAuthenticated;
  if (!isAuthenticated) {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    return;
  }

  if (view === 'battle') {
    main.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    battle.hidden = false;
    renderBattleScreen();
  } else if (view === 'adventure') {
    main.hidden = true;
    battle.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
    adventure.hidden = false;
    renderAdventureScreen();
  } else if (view === 'edit') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    if (talents) talents.hidden = true;
    edit.hidden = false;
    renderEditScreen();
  } else if (view === 'talents') {
    main.hidden = true;
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = false;
    renderTalentsScreen();
  } else {
    battle.hidden = true;
    adventure.hidden = true;
    edit.hidden = true;
    if (talents) talents.hidden = true;
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
      setView('adventure');
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
    void refreshFriendsBadge(true);
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
  setupSocialPolling();
  render();
  await loadState();

  if (!uiTicker) {
    uiTicker = window.setInterval(() => {
      if (!currentState.activeBossId) {
        currentState = advanceLocalEnergy(currentState);
      }
      render();
    }, 1000);
  }
});