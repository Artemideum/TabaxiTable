(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.TT_ITEM_SYSTEM = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const keyAliases = Object.freeze({
    "light-crossbow":"crossbow-light",
    "hand-crossbow":"crossbow-hand",
    padded:"padded-armor",
    leather:"leather-armor",
    studded:"studded-leather-armor",
    hide:"hide-armor",
    scale:"scale-mail",
    "half-plate":"half-plate-armor",
    splint:"splint-armor",
    plate:"plate-armor",
    arrows:"arrow",
    bolts:"crossbow-bolt",
    rope:"rope-hempen-50-feet",
    rations:"rations-1-day",
    "potion-healing":"magic-potion-of-healing-common"
  });

  const simpleWeaponKeys = Object.freeze(new Set([
    "club","dagger","greatclub","handaxe","javelin","light-hammer","mace","quarterstaff","sickle","spear",
    "crossbow-light","dart","shortbow","sling"
  ]));

  const strengthRequirements = Object.freeze({
    "chain-mail":13,
    "splint-armor":15,
    "plate-armor":15
  });

  const preferredBaseKeys = Object.freeze({
    "magic-berserker-axe":"battleaxe",
    "magic-dagger-of-venom":"dagger",
    "magic-dancing-sword":"longsword",
    "magic-defender":"longsword",
    "magic-dragon-slayer":"longsword",
    "magic-dwarven-thrower":"warhammer",
    "magic-flame-tongue":"longsword",
    "magic-frost-brand":"longsword",
    "magic-giant-slayer":"longsword",
    "magic-hammer-of-thunderbolts":"maul",
    "magic-holy-avenger":"longsword",
    "magic-javelin-of-lightning":"javelin",
    "magic-luck-blade":"longsword",
    "magic-mace-of-disruption":"mace",
    "magic-mace-of-smiting":"mace",
    "magic-mace-of-terror":"mace",
    "magic-nine-lives-stealer":"longsword",
    "magic-oathbow":"longbow",
    "magic-scimitar-of-speed":"scimitar",
    "magic-sun-blade":"longsword",
    "magic-sword-of-life-stealing":"longsword",
    "magic-sword-of-sharpness":"longsword",
    "magic-sword-of-wounding":"longsword",
    "magic-trident-of-fish-command":"trident",
    "magic-vicious-weapon":"longsword",
    "magic-vorpal-sword":"longsword",
    "magic-weapon-1":"longsword",
    "magic-weapon-2":"longsword",
    "magic-weapon-3":"longsword",
    "magic-adamantine-armor":"chain-mail",
    "magic-animated-shield":"shield",
    "magic-armor-1":"chain-mail",
    "magic-armor-2":"chain-mail",
    "magic-armor-3":"chain-mail",
    "magic-armor-of-invulnerability":"plate-armor",
    "magic-armor-of-resistance":"chain-mail",
    "magic-armor-of-vulnerability":"chain-mail",
    "magic-arrow-catching-shield":"shield",
    "magic-demon-armor":"plate-armor",
    "magic-dragon-scale-mail-black":"scale-mail",
    "magic-dragon-scale-mail-blue":"scale-mail",
    "magic-dragon-scale-mail-brass":"scale-mail",
    "magic-dragon-scale-mail-bronze":"scale-mail",
    "magic-dragon-scale-mail-copper":"scale-mail",
    "magic-dragon-scale-mail-gold":"scale-mail",
    "magic-dragon-scale-mail-green":"scale-mail",
    "magic-dragon-scale-mail-red":"scale-mail",
    "magic-dragon-scale-mail-silver":"scale-mail",
    "magic-dragon-scale-mail-white":"scale-mail",
    "magic-dwarven-plate":"plate-armor",
    "magic-elven-chain":"chain-shirt",
    "magic-glamoured-studded-leather":"studded-leather-armor",
    "magic-mithral-armor":"chain-mail",
    "magic-plate-armor-of-etherealness":"plate-armor",
    "magic-shield-1":"shield",
    "magic-shield-2":"shield",
    "magic-shield-3":"shield",
    "magic-shield-of-missile-attraction":"shield",
    "magic-spellguard-shield":"shield",
    "magic-ammunition-1":"arrow",
    "magic-ammunition-2":"arrow",
    "magic-ammunition-3":"arrow",
    "magic-arrow-of-slaying":"arrow"
  });

  const extraDamageByKey = Object.freeze({
    "magic-flame-tongue": { formula:"2d6", damageType:"огненный" },
    "magic-frost-brand": { formula:"1d6", damageType:"холод" },
    "magic-vicious-weapon": { formula:"2d6", damageType:"того же типа", criticalOnly:true }
  });

  const localizedNames = Object.freeze({
    "magic-amulet-of-proof-against-detection-and-location":"Амулет защиты от обнаружения и поиска",
    "magic-apparatus-of-the-crab":"Крабий аппарат",
    "magic-armor-of-vulnerability":"Доспех уязвимости",
    "magic-belt-of-giant-strength-hill":"Пояс силы холмового великана",
    "magic-belt-of-giant-strength-stone":"Пояс силы каменного великана",
    "magic-belt-of-giant-strength-frost":"Пояс силы морозного великана",
    "magic-belt-of-giant-strength-fire":"Пояс силы огненного великана",
    "magic-belt-of-giant-strength-cloud":"Пояс силы облачного великана",
    "magic-belt-of-giant-strength-storm":"Пояс силы штормового великана",
    "magic-bowl-of-commanding-water-elementals":"Чаша управления водяными элементалями",
    "magic-brazier-of-commanding-fire-elementals":"Жаровня управления огненными элементалями",
    "magic-candle-of-invocation":"Свеча призыва",
    "magic-carpet-of-flying-3x5":"Ковёр-самолёт, 3 × 5 футов",
    "magic-carpet-of-flying-4x6":"Ковёр-самолёт, 4 × 6 футов",
    "magic-carpet-of-flying-5x7":"Ковёр-самолёт, 5 × 7 футов",
    "magic-carpet-of-flying-6x9":"Ковёр-самолёт, 6 × 9 футов",
    "magic-censer-of-controlling-air-elementals":"Кадило управления воздушными элементалями",
    "magic-crystal-ball-of-mind-reading":"Хрустальный шар чтения мыслей",
    "magic-crystal-ball-of-telepathy":"Хрустальный шар телепатии",
    "magic-crystal-ball-of-true-seeing":"Хрустальный шар истинного зрения",
    "magic-dragon-scale-mail-black":"Чешуйчатый доспех чёрного дракона",
    "magic-dragon-scale-mail-blue":"Чешуйчатый доспех синего дракона",
    "magic-dragon-scale-mail-brass":"Чешуйчатый доспех латунного дракона",
    "magic-dragon-scale-mail-bronze":"Чешуйчатый доспех бронзового дракона",
    "magic-dragon-scale-mail-copper":"Чешуйчатый доспех медного дракона",
    "magic-dragon-scale-mail-gold":"Чешуйчатый доспех золотого дракона",
    "magic-dragon-scale-mail-green":"Чешуйчатый доспех зелёного дракона",
    "magic-dragon-scale-mail-red":"Чешуйчатый доспех красного дракона",
    "magic-dragon-scale-mail-silver":"Чешуйчатый доспех серебряного дракона",
    "magic-dragon-scale-mail-white":"Чешуйчатый доспех белого дракона",
    "magic-elemental-gem-air":"Самоцвет воздушного элементаля",
    "magic-elemental-gem-earth":"Самоцвет земляного элементаля",
    "magic-elemental-gem-fire":"Самоцвет огненного элементаля",
    "magic-elemental-gem-water":"Самоцвет водяного элементаля",
    "magic-feather-token-anchor":"Перьевой жетон: якорь",
    "magic-feather-token-bird":"Перьевой жетон: птица",
    "magic-feather-token-fan":"Перьевой жетон: веер",
    "magic-feather-token-swan-boat":"Перьевой жетон: лебединая лодка",
    "magic-feather-token-tree":"Перьевой жетон: дерево",
    "magic-feather-token-whip":"Перьевой жетон: кнут",
    "magic-figurine-of-wondrous-power-bronze-griffon":"Фигурка чудесной силы: бронзовый грифон",
    "magic-figurine-of-wondrous-power-ebony-fly":"Фигурка чудесной силы: эбеновая муха",
    "magic-figurine-of-wondrous-power-golden-lions":"Фигурка чудесной силы: золотые львы",
    "magic-figurine-of-wondrous-power-ivory-goats":"Фигурка чудесной силы: костяные козлы",
    "magic-figurine-of-wondrous-power-marble-elephant":"Фигурка чудесной силы: мраморный слон",
    "magic-figurine-of-wondrous-power-obsidian-steed":"Фигурка чудесной силы: обсидиановый скакун",
    "magic-figurine-of-wondrous-power-onyx-dog":"Фигурка чудесной силы: ониксовая собака",
    "magic-figurine-of-wondrous-power-serpentine-owl":"Фигурка чудесной силы: змеевиковая сова",
    "magic-figurine-of-wondrous-power-silver-raven":"Фигурка чудесной силы: серебряный ворон",
    "magic-horn-of-valhalla-silver":"Серебряный рог Валгаллы",
    "magic-horn-of-valhalla-brass":"Латунный рог Валгаллы",
    "magic-horn-of-valhalla-bronze":"Бронзовый рог Валгаллы",
    "magic-horn-of-valhalla-iron":"Железный рог Валгаллы",
    "magic-horseshoes-of-a-zephyr":"Подковы зефира",
    "magic-horseshoes-of-speed":"Подковы скорости",
    "magic-ioun-stone-of-absorption":"Камень Иоун: поглощение",
    "magic-ioun-stone-of-agility":"Камень Иоун: ловкость",
    "magic-ioun-stone-of-awareness":"Камень Иоун: бдительность",
    "magic-ioun-stone-of-fortitude":"Камень Иоун: стойкость",
    "magic-ioun-stone-of-greater-absorption":"Камень Иоун: великое поглощение",
    "magic-ioun-stone-of-insight":"Камень Иоун: проницательность",
    "magic-ioun-stone-of-intellect":"Камень Иоун: интеллект",
    "magic-ioun-stone-of-leadership":"Камень Иоун: лидерство",
    "magic-ioun-stone-of-mastery":"Камень Иоун: мастерство",
    "magic-ioun-stone-of-protection":"Камень Иоун: защита",
    "magic-ioun-stone-of-regeneration":"Камень Иоун: регенерация",
    "magic-ioun-stone-of-reserve":"Камень Иоун: запас",
    "magic-ioun-stone-of-strength":"Камень Иоун: сила",
    "magic-ioun-stone-of-sustenance":"Камень Иоун: поддержание жизни",
    "magic-manual-of-golems-clay":"Руководство по глиняным големам",
    "magic-manual-of-golems-flesh":"Руководство по големам из плоти",
    "magic-manual-of-golems-iron":"Руководство по железным големам",
    "magic-manual-of-golems-stone":"Руководство по каменным големам",
    "magic-potion-of-animal-friendship":"Зелье дружбы с животными",
    "magic-potion-of-clairvoyance":"Зелье ясновидения",
    "magic-potion-of-climbing":"Зелье лазания",
    "magic-potion-of-diminution":"Зелье уменьшения",
    "magic-potion-of-flying":"Зелье полёта",
    "magic-potion-of-gaseous-form":"Зелье газообразной формы",
    "magic-potion-of-giant-strength-hill":"Зелье силы холмового великана",
    "magic-potion-of-giant-strength-frost":"Зелье силы морозного великана",
    "magic-potion-of-giant-strength-stone":"Зелье силы каменного великана",
    "magic-potion-of-giant-strength-fire":"Зелье силы огненного великана",
    "magic-potion-of-giant-strength-cloud":"Зелье силы облачного великана",
    "magic-potion-of-giant-strength-storm":"Зелье силы штормового великана",
    "magic-potion-of-growth":"Зелье роста",
    "magic-potion-of-healing-common":"Зелье лечения",
    "magic-potion-of-healing-greater":"Большое зелье лечения",
    "magic-potion-of-healing-superior":"Отличное зелье лечения",
    "magic-potion-of-healing-supreme":"Высшее зелье лечения",
    "magic-potion-of-heroism":"Зелье героизма",
    "magic-potion-of-invisibility":"Зелье невидимости",
    "magic-potion-of-mind-reading":"Зелье чтения мыслей",
    "magic-potion-of-poison":"Зелье яда",
    "magic-potion-of-resistance-acid":"Зелье сопротивления кислоте",
    "magic-potion-of-resistance-cold":"Зелье сопротивления холоду",
    "magic-potion-of-resistance-fire":"Зелье сопротивления огню",
    "magic-potion-of-resistance-force":"Зелье сопротивления силовому урону",
    "magic-potion-of-resistance-lightning":"Зелье сопротивления электричеству",
    "magic-potion-of-resistance-necrotic":"Зелье сопротивления некротическому урону",
    "magic-potion-of-resistance-poison":"Зелье сопротивления яду",
    "magic-potion-of-resistance-psychic":"Зелье сопротивления психическому урону",
    "magic-potion-of-resistance-radiant":"Зелье сопротивления излучению",
    "magic-potion-of-resistance-thunder":"Зелье сопротивления звуковому урону",
    "magic-potion-of-speed":"Зелье скорости",
    "magic-potion-of-water-breathing":"Зелье подводного дыхания",
    "magic-ring-of-djinni-summoning":"Кольцо призыва джинна",
    "magic-ring-of-elemental-command-air":"Кольцо управления воздушными элементалями",
    "magic-ring-of-elemental-command-earth":"Кольцо управления земляными элементалями",
    "magic-ring-of-elemental-command-fire":"Кольцо управления огненными элементалями",
    "magic-ring-of-elemental-command-water":"Кольцо управления водяными элементалями",
    "magic-ring-of-resistance-acid":"Кольцо сопротивления кислоте",
    "magic-ring-of-resistance-cold":"Кольцо сопротивления холоду",
    "magic-ring-of-resistance-fire":"Кольцо сопротивления огню",
    "magic-ring-of-resistance-force":"Кольцо сопротивления силовому урону",
    "magic-ring-of-resistance-lightning":"Кольцо сопротивления электричеству",
    "magic-ring-of-resistance-necrotic":"Кольцо сопротивления некротическому урону",
    "magic-ring-of-resistance-poison":"Кольцо сопротивления яду",
    "magic-ring-of-resistance-psychic":"Кольцо сопротивления психическому урону",
    "magic-ring-of-resistance-radiant":"Кольцо сопротивления излучению",
    "magic-ring-of-resistance-thunder":"Кольцо сопротивления звуковому урону",
    "magic-rod-of-absorption":"Жезл поглощения",
    "magic-rod-of-alertness":"Жезл бдительности",
    "magic-rod-of-lordly-might":"Жезл властной мощи",
    "magic-rod-of-rulership":"Жезл правления",
    "magic-rod-of-security":"Жезл безопасности",
    "magic-stone-of-controlling-earth-elementals":"Камень управления земляными элементалями",
    "magic-talisman-of-pure-good":"Талисман абсолютного добра",
    "magic-talisman-of-the-sphere":"Талисман сферы",
    "magic-talisman-of-ultimate-evil":"Талисман абсолютного зла",
    "magic-wand-of-the-war-mage-1":"Жезл боевого мага +1",
    "magic-wand-of-the-war-mage-2":"Жезл боевого мага +2",
    "magic-wand-of-the-war-mage-3":"Жезл боевого мага +3"
  });

  function normalizeCatalogKey(value) {
    const key = String(value || "").trim();
    return keyAliases[key] || key;
  }

  function inferMagicBonus(item) {
    const explicit = Number(item?.magicBonus || 0);
    if (Number.isFinite(explicit) && explicit) return Math.max(-10, Math.min(10, explicit));
    const text = `${item?.key || ""} ${item?.name || ""} ${item?.originalName || ""}`;
    const match = text.match(/(?:^|[-,\s])\+?([123])(?:$|[-,\s])/);
    return match ? Number(match[1]) : 0;
  }

  function isMagicVariant(item) {
    return Boolean(item?.magical && ["weapon","armor","ammunition"].includes(item?.magicCategory));
  }

  function isStackable(item) {
    const category = item?.catalogCategory;
    return item?.combatKind === "ammo" || item?.combatKind === "consumable" || ["ammo","consumable","gear","focus","tool","potion","scroll"].includes(category);
  }

  function localizeName(item) {
    return localizedNames[normalizeCatalogKey(item?.key || item?.catalogKey)] || item?.name || "Предмет";
  }

  function preferredBaseKey(item) {
    return normalizeCatalogKey(item?.baseCatalogKey || preferredBaseKeys[normalizeCatalogKey(item?.key || item?.catalogKey)] || "");
  }

  function enrichCatalogItem(item) {
    const key = normalizeCatalogKey(item?.key || item?.catalogKey);
    const localized = localizeName({ ...item, key });
    const magicBonus = inferMagicBonus({ ...item, key });
    return {
      ...item,
      key,
      name:localized,
      magicBonus,
      suggestedBaseKey:preferredBaseKey({ ...item, key }),
      extraDamage:extraDamageByKey[key] || item?.extraDamage || null
    };
  }

  function canonicalizeInventoryItem(item) {
    const catalogKey = normalizeCatalogKey(item?.catalogKey || item?.key);
    const baseCatalogKey = normalizeCatalogKey(item?.baseCatalogKey);
    return {
      ...item,
      catalogKey,
      baseCatalogKey,
      name:localizedNames[catalogKey] || item?.name,
      magicBonus:inferMagicBonus({ ...item, key:catalogKey })
    };
  }

  function buildMagicVariant(source, baseSource) {
    const sourceItem = enrichCatalogItem(source || {});
    const base = enrichCatalogItem(baseSource || {});
    if (!isMagicVariant(sourceItem) || !base.key) return null;
    const bonus = Number(sourceItem.magicBonus || 0);
    const generic = /^magic-(weapon|armor|ammunition)-[123]$/.test(sourceItem.key);
    const name = generic && bonus ? `${base.name} +${bonus}` : sourceItem.name;
    const combatKind = sourceItem.magicCategory === "weapon" ? "weapon" : sourceItem.magicCategory === "armor" ? "armor" : "ammo";
    return {
      ...base,
      ...sourceItem,
      key:undefined,
      catalogKey:sourceItem.key,
      baseCatalogKey:base.key,
      name,
      variantLabel:base.name,
      type:base.type,
      catalogCategory:"magic",
      combatKind,
      quantity:Math.max(1,Number(sourceItem.quantity || 1)),
      weight:Number(base.weight || 0),
      damage:base.damage || "",
      damageType:base.damageType || "",
      ability:base.ability || "",
      properties:base.properties || "",
      rangeNormal:Number(base.rangeNormal || 0),
      rangeLong:Number(base.rangeLong || 0),
      baseAc:Number(base.baseAc || 0),
      armorType:base.armorType || "",
      stealthDisadvantage:Boolean(base.stealthDisadvantage),
      strengthMinimum:Number(base.strengthMinimum || strengthRequirements[base.key] || 0),
      slotHint:sourceItem.slotHint || (sourceItem.magicCategory === "ammunition" ? "ammo" : base.slotHint || ""),
      magicBonus:bonus,
      magical:true,
      description:[sourceItem.description,`Основа: ${base.name}.`].filter(Boolean).join("\n"),
      extraDamage:sourceItem.extraDamage || null
    };
  }

  return Object.freeze({
    keyAliases,
    simpleWeaponKeys,
    strengthRequirements,
    localizedNames,
    normalizeCatalogKey,
    inferMagicBonus,
    isMagicVariant,
    isStackable,
    localizeName,
    preferredBaseKey,
    enrichCatalogItem,
    canonicalizeInventoryItem,
    buildMagicVariant,
    extraDamageByKey
  });
});
