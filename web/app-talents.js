"use strict";

(function initTalentsModule() {
  const classDefs = [
    {
      id: 'martial_arts',
      name: 'Хомяк боевых искусств',
      image: '/assets/talents/classes/martial_arts.png',
      tags: ['скорость', 'рукопашный', 'экономичный'],
      description: 'Основной упор на скорость и ближний бой. Класс простой в использовании и экономно раскрывает урон через укусы и энергию.',
    },
    {
      id: 'authority',
      name: 'Авторитет',
      image: '/assets/talents/classes/authority.png',
      tags: ['сбалансированный', 'стабильный', 'простой'],
      description: 'Ровный и понятный класс со стабильным уроном царапаньем и бонусами для бизнеса.',
    },
    {
      id: 'berserk',
      name: 'Бешенный',
      image: '/assets/talents/classes/berserk.png',
      tags: ['урон', 'затратность', 'лидерство'],
      description: 'Класс для максимального урона. Открывает яд, лазеры из глаз и железный коготь, но требует больше внимания к расходам.',
    },
  ];

  const skillDefs = [
    {
      id: 'martial_energy',
      classId: 'martial_arts',
      name: 'Запас энергии',
      image: '/assets/talents/icons/martial_energy.png',
      description: '+1 к максимальному запасу энергии.',
      bonusText: 'Каждый ранг увеличивает максимум энергии на 1.',
      wip: false,
      prerequisite: null,
    },
    {
      id: 'martial_bite',
      classId: 'martial_arts',
      name: 'Укус',
      image: '/assets/talents/icons/martial_scratch.png',
      description: '+5 к урону от укуса.',
      bonusText: 'Каждый ранг увеличивает урон укуса на 5.',
      wip: false,
      prerequisite: { skillId: 'martial_energy', rank: 10 },
    },
    {
      id: 'authority_scratch',
      classId: 'authority',
      name: 'Царапанье',
      image: '/assets/talents/icons/authority_scratch.png',
      description: '+2 к урону царапаньем.',
      bonusText: 'Каждый ранг увеличивает урон царапанья на 2.',
      wip: false,
      prerequisite: null,
    },
    {
      id: 'authority_shop_income',
      classId: 'authority',
      name: 'Доход магазина',
      image: '/assets/talents/icons/authority_shop_income.png',
      description: '+5 семечек к доходу от бизнеса магазин каждые 12 часов.',
      bonusText: 'Каждый ранг увеличивает доход магазина на 5 семечек за цикл.',
      wip: false,
      prerequisite: { skillId: 'authority_scratch', rank: 10 },
    },
    {
      id: 'authority_wheel_xp',
      classId: 'authority',
      name: 'Доход колёсика',
      image: '/assets/talents/icons/authority_wheel_xp.png',
      description: '+1 опыт к доходу от бизнеса колёсико каждые 12 часов.',
      bonusText: 'Каждый ранг увеличивает доход колёсика на 1 опыт за цикл.',
      wip: false,
      prerequisite: { skillId: 'authority_shop_income', rank: 10 },
    },
    {
      id: 'berserk_poison',
      classId: 'berserk',
      name: 'Ядовитый укус',
      image: '/assets/talents/icons/berserk_poison.png',
      description: '+15 к урону от яда.',
      bonusText: 'Каждый ранг увеличивает урон яда на 15.',
      wip: false,
      prerequisite: null,
    },
    {
      id: 'berserk_lasers',
      classId: 'berserk',
      name: 'Лазеры из глаз',
      image: '/assets/talents/icons/berserk_lasers.png',
      description: '+30 к урону от лазеров из глаз.',
      bonusText: 'Каждый ранг увеличивает урон лазеров на 30.',
      wip: false,
      prerequisite: { skillId: 'berserk_poison', rank: 10 },
    },
    {
      id: 'berserk_iron_claw',
      classId: 'berserk',
      name: 'Железный коготь',
      image: '/assets/talents/icons/berserk_iron_claw.png',
      description: '+12 к урону от удара железным когтем.',
      bonusText: 'Каждый ранг увеличивает урон железного когтя на 12.',
      wip: false,
      prerequisite: { skillId: 'berserk_lasers', rank: 10 },
    },
  ];

  // Позиции узлов привязаны к красным точкам на картинке дерева.
  // Чтобы сдвинуть любой скилл, меняй только top/left в процентах.
  const skillPositions = {
    martial_arts: [
      { top: '12.7%', left: '50.0%' },
      { top: '22.5%', left: '50.0%' },
    ],
    authority: [
      { top: '12.7%', left: '45.0%' },
      { top: '22.0%', left: '45.0%' },
      { top: '31.0%', left: '45.0%' },
    ],
    berserk: [
      { top: '12.7%', left: '44.8%' },
      { top: '22.5%', left: '44.5%' },
      { top: '31.0%', left: '45.0%' },
    ],
  };

  const classMap = new Map(classDefs.map((item) => [item.id, item]));
  const skillMap = new Map(skillDefs.map((item) => [item.id, item]));
  const classSkills = new Map();
  for (const skill of skillDefs) {
    if (!classSkills.has(skill.classId)) classSkills.set(skill.classId, []);
    classSkills.get(skill.classId).push(skill);
  }

  function clampRank(value) {
    const num = Number(value) || 0;
    return Math.max(0, Math.min(10, num));
  }

  function normalizeTalentState(state) {
    if (!state || !state.player) return state;
    const player = state.player;
    if (!player.talents || typeof player.talents !== 'object') {
      player.talents = {};
    }

    if (Object.prototype.hasOwnProperty.call(player.talents, 'martial_scratch') && !Object.prototype.hasOwnProperty.call(player.talents, 'martial_bite')) {
      player.talents.martial_bite = clampRank(player.talents.martial_scratch);
    }
    if (Object.prototype.hasOwnProperty.call(player.talents, 'authority_wip_tier2') && !Object.prototype.hasOwnProperty.call(player.talents, 'authority_shop_income')) {
      player.talents.authority_shop_income = clampRank(player.talents.authority_wip_tier2);
    }
    if (Object.prototype.hasOwnProperty.call(player.talents, 'authority_wip_tier3') && !Object.prototype.hasOwnProperty.call(player.talents, 'authority_wheel_xp')) {
      player.talents.authority_wheel_xp = clampRank(player.talents.authority_wip_tier3);
    }
    delete player.talents.martial_scratch;
    delete player.talents.authority_wip_tier2;
    delete player.talents.authority_wip_tier3;

    for (const key of Object.keys(player.talents)) {
      if (!skillMap.has(key)) {
        delete player.talents[key];
        continue;
      }
      player.talents[key] = clampRank(player.talents[key]);
    }

    if (player.talentClass && !classMap.has(player.talentClass)) {
      player.talentClass = '';
    }

    player.talentPoints = Math.max(0, Number(player.talentPoints) || 0);
    player.talentDamageProgress = Math.max(0, Number(player.talentDamageProgress) || 0);
    player.talentNextThreshold = Math.max(70, Number(player.talentNextThreshold) || 70);
    return state;
  }

  function getTalentClassDefinition(classId) {
    return classMap.get(String(classId || '').trim()) || null;
  }

  function getTalentSkillDefinition(skillId) {
    return skillMap.get(String(skillId || '').trim()) || null;
  }

  function getTalentSkillPrerequisite(skillId) {
    const skill = getTalentSkillDefinition(skillId);
    return skill?.prerequisite || null;
  }

  function isTalentSkillUnlocked(state, skillId) {
    const skill = getTalentSkillDefinition(skillId);
    if (!skill) return false;
    const classId = state?.player?.talentClass || '';
    if (!classId || skill.classId !== classId) return false;
    if (skill.wip) return false;
    const prerequisite = skill.prerequisite;
    if (prerequisite) {
      const current = clampRank(state?.player?.talents?.[prerequisite.skillId]);
      if (current < prerequisite.rank) return false;
    }
    return true;
  }

  function getTalentAttackBonus(state, attackType) {
    const classId = state?.player?.talentClass || '';
    if (!classId) return 0;
    const rank = (skillId) => clampRank(state?.player?.talents?.[skillId]);

    switch (attackType) {
      case 'scratch':
        return classId === 'authority' ? 2 * rank('authority_scratch') : 0;
      case 'bite':
        return classId === 'martial_arts' ? 5 * rank('martial_bite') : 0;
      case 'poison_bite':
        return classId === 'berserk' ? 15 * rank('berserk_poison') : 0;
      case 'eye_lasers':
        return classId === 'berserk' ? 30 * rank('berserk_lasers') : 0;
      case 'iron_claw':
        return classId === 'berserk' ? 12 * rank('berserk_iron_claw') : 0;
      default:
        return 0;
    }
  }

  function talentProgressState(state) {
    const player = state?.player || {};
    const points = Math.max(0, Number(player.talentPoints) || 0);
    const progress = Math.max(0, Number(player.talentDamageProgress) || 0);
    const threshold = Math.max(70, Number(player.talentNextThreshold) || 70);
    const pct = Math.max(0, Math.min(100, (progress / threshold) * 100));
    const remaining = Math.max(0, threshold - progress);
    return { points, progress, threshold, pct, remaining };
  }

  function progressBarMarkup(pct) {
    return `<div class="progress-bar"><div style="width: ${Math.max(0, Math.min(100, pct))}%"></div></div>`;
  }

  function renderTalentBattleWidget(state) {
    const player = state?.player || {};
    const selectedClass = getTalentClassDefinition(player.talentClass);
    const { points, progress, threshold, pct, remaining } = talentProgressState(state);

    return `
      <div class="battle-talent-widget">
        <div class="battle-talent-widget__head">
          <div>
            <strong>Очки талантов</strong>
            <span>${selectedClass ? `Класс: ${selectedClass.name}` : 'Сначала выбери класс в талантах.'}</span>
          </div>
          <div class="tag">Доступно: ${points}</div>
        </div>
        <div class="battle-talent-widget__hint">
          ${selectedClass
            ? `Получай очки только за урон в одном бою с боссом. Сейчас ${progress}/${threshold}, до следующего очка осталось ${remaining}.`
            : 'Побеждай боссов и открой вкладку талантов, чтобы выбрать класс.'}
        </div>
        ${progressBarMarkup(pct)}
      </div>
    `;
  }

  function renderTalentPips(rank) {
    const filled = clampRank(rank);
    let html = '<div class="talent-pips">';
    for (let i = 0; i < 10; i += 1) {
      html += `<span class="talent-pip ${i < filled ? 'is-filled' : ''}"></span>`;
    }
    html += '</div>';
    return html;
  }

  function renderClassCard(def, currentClassId) {
    const selected = currentClassId === def.id;
    const locked = currentClassId && !selected;
    const actionText = selected ? 'Класс выбран' : (locked ? 'Класс уже выбран' : 'Выбрать класс');
    const actionDisabled = selected || locked;
    return `
      <article class="talent-class-card ${selected ? 'is-selected' : ''}">
        <div class="talent-class-card__image">
          <img src="${def.image}" alt="${def.name}">
        </div>
        <div class="talent-class-card__body">
          <strong>${def.name}</strong>
          <p>${def.description}</p>
          <div class="talent-class-tags">
            ${def.tags.map((tag) => `<span class="talent-tag">${tag}</span>`).join('')}
          </div>
        </div>
        <div class="talent-class-card__actions">
          <button type="button" class="primary" data-select-talent-class="${def.id}" ${actionDisabled ? 'disabled' : ''}>${actionText}</button>
        </div>
      </article>
    `;
  }

  function renderTalentTreeNode(skill, currentRank, talentPoints, currentClassId, player) {
    const positionList = skillPositions[currentClassId] || [];
    const index = classSkills.get(currentClassId)?.findIndex((item) => item.id === skill.id) ?? -1;
    const position = index >= 0 ? positionList[index] : { top: '50%', left: '50%' };
    const maxed = currentRank >= 10;
    const unlocked = isTalentSkillUnlocked({ player }, skill.id);
    const canBuy = unlocked && talentPoints > 0 && !maxed;
    const prerequisite = skill.prerequisite;
    const prerequisiteOk = !prerequisite || clampRank(player.talents?.[prerequisite.skillId]) >= prerequisite.rank;
    const statusText = skill.wip
      ? 'В разработке'
      : maxed
        ? 'Максимум'
        : prerequisite && !prerequisiteOk
          ? `Нужен ${getTalentSkillDefinition(prerequisite.skillId)?.name || prerequisite.skillId} 10/10`
          : canBuy
            ? 'Прокачать за 1 очко'
            : 'Недоступно';
    const classes = [
      'talent-tree-map__node',
      maxed ? 'is-max' : '',
      skill.wip ? 'is-wip' : '',
      prerequisite && !prerequisiteOk ? 'is-locked' : '',
    ].filter(Boolean).join(' ');

    return `
      <button
        type="button"
        class="${classes}"
        style="top: ${position.top}; left: ${position.left};"
        data-buy-talent="${skill.id}"
        ${canBuy ? '' : 'disabled'}
        title="${skill.name} — ${statusText}"
        aria-label="${skill.name}. ${statusText}"
      >
        <img src="${skill.image}" alt="${skill.name}">
        <span class="talent-tree-map__rank">${currentRank}/10</span>
      </button>
    `;
  }

  function renderTalentTreeMap(currentClassId, player, points) {
    const skills = classSkills.get(currentClassId) || [];
    if (!skills.length) return '';
    return `
      <div class="talent-tree-map">
        <img class="talent-tree-map__bg" src="/assets/talents/tree.png" alt="Дерево талантов">
        <div class="talent-tree-map__overlay">
          ${skills.map((skill) => renderTalentTreeNode(skill, clampRank(player.talents?.[skill.id]), points, currentClassId, player)).join('')}
        </div>
      </div>
    `;
  }

  function renderSkillListCard(skill, currentRank, points, currentClassId, player) {
    const maxed = currentRank >= 10;
    const prerequisite = skill.prerequisite;
    const prerequisiteOk = !prerequisite || clampRank(player.talents?.[prerequisite.skillId]) >= prerequisite.rank;
    const unlocked = isTalentSkillUnlocked({ player }, skill.id);
    const canBuy = unlocked && points > 0 && !maxed;
    const statusText = skill.wip
      ? 'В разработке'
      : maxed
        ? 'Максимум'
        : prerequisite && !prerequisiteOk
          ? `Сначала ${getTalentSkillDefinition(prerequisite.skillId)?.name || prerequisite.skillId} 10/10`
          : canBuy
            ? 'Готов к прокачке'
            : 'Недоступно';

    return `
      <article class="talent-node ${maxed ? 'is-max' : ''} ${skill.wip ? 'is-wip' : ''} ${prerequisite && !prerequisiteOk ? 'is-locked' : ''}">
        <div class="talent-node__top">
          <img class="talent-node__icon" src="${skill.image}" alt="${skill.name}">
          <div class="talent-node__meta">
            <strong>${skill.name}</strong>
            <span>${skill.description}</span>
          </div>
        </div>
        <div class="talent-node__chips">
          <span class="talent-rank">Уровень ${currentRank}/10</span>
          <span class="tag">${statusText}</span>
        </div>
        ${renderTalentPips(currentRank)}
        <div class="talent-note">${skill.bonusText}</div>
        <div class="talent-node__footer">
          <button type="button" class="primary" data-buy-talent="${skill.id}" ${canBuy ? '' : 'disabled'}>
            ${skill.wip ? 'Недоступно' : (maxed ? 'Максимум' : 'Прокачать за 1 очко')}
          </button>
        </div>
      </article>
    `;
  }

  function renderTalentsScreen() {
    const body = document.getElementById('talents-screen-body');
    if (!body || typeof currentState === 'undefined') return;
    normalizeTalentState(currentState);

    const player = currentState.player || {};
    const currentClassId = player.talentClass || '';
    const currentClass = getTalentClassDefinition(currentClassId);
    const { points, progress, threshold, pct, remaining } = talentProgressState(currentState);
    const selectedSkills = currentClassId ? (classSkills.get(currentClassId) || []) : [];

    body.innerHTML = `
      <div class="talents-layout">
        <section class="talents-banner">
          <div class="talents-banner__head">
            <div>
              <strong>${currentClass ? currentClass.name : 'Выбор класса талантов'}</strong>
              <span>${currentClass ? currentClass.description : 'Сначала выбери один из 3 классов, после этого откроется дерево талантов.'}</span>
            </div>
            <div class="tag">Очки талантов: ${points}</div>
          </div>
          <div class="talents-progress">
            <div class="talents-progress__row">
              <span>Прогресс к новому очку</span>
              <strong>${progress}/${threshold} • осталось ${remaining}</strong>
            </div>
            ${progressBarMarkup(pct)}
            <div class="talent-note">Первое очко выдаётся за 70 урона по боссам, дальше порог растёт на 50 после каждого полученного очка.</div>
          </div>
        </section>

        <section>
          <div class="talent-tree__head" style="margin-bottom: 12px;">
            <div>
              <strong>Классы</strong>
              <span>Выбери только один. Смена после выбора недоступна.</span>
            </div>
            <div class="tag">${currentClass ? `Выбран: ${currentClass.name}` : 'Класс ещё не выбран'}</div>
          </div>
          <div class="talent-class-grid">
            ${classDefs.map((def) => renderClassCard(def, currentClassId)).join('')}
          </div>
        </section>

        ${currentClass ? `
          <section class="talent-tree">
            <div class="talent-tree__head">
              <div>
                <strong>Дерево талантов</strong>
                <span>Таланты идут сверху вниз. Следующий талант можно купить только после прокачки предыдущего до 10/10.</span>
              </div>
              <div class="tag">Доступно очков: ${points}</div>
            </div>
            ${renderTalentTreeMap(currentClassId, player, points)}
            <div class="talent-tree-grid">
              ${selectedSkills.map((skill) => renderSkillListCard(skill, clampRank(player.talents?.[skill.id]), points, currentClassId, player)).join('')}
            </div>
          </section>
        ` : `
          <div class="talent-note">После выбора класса здесь появится дерево талантов. Каждый талант качается за 1 очко до 10 раз.</div>
        `}
      </div>
    `;

    body.querySelectorAll('[data-select-talent-class]').forEach((btn) => {
      btn.onclick = async () => {
        const classId = btn.dataset.selectTalentClass;
        if (!classId) return;
        btn.disabled = true;
        await syncAction('select_talent_class', { value: classId });
        setView('talents');
        render();
      };
    });

    body.querySelectorAll('[data-buy-talent]').forEach((btn) => {
      btn.onclick = async () => {
        const skillId = btn.dataset.buyTalent;
        if (!skillId) return;
        btn.disabled = true;
        await syncAction('buy_talent', { slot: skillId });
        setView('talents');
        render();
      };
    });
  }

  window.normalizeTalentState = normalizeTalentState;
  window.getTalentClassDefinition = getTalentClassDefinition;
  window.getTalentSkillDefinition = getTalentSkillDefinition;
  window.getTalentSkillPrerequisite = getTalentSkillPrerequisite;
  window.isTalentSkillUnlocked = isTalentSkillUnlocked;
  window.getTalentAttackBonus = getTalentAttackBonus;
  window.renderTalentBattleWidget = renderTalentBattleWidget;
  window.renderTalentsScreen = renderTalentsScreen;
})();