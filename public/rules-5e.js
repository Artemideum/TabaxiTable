(function () {
  const fullSlots = [
    [], [2], [3], [4,2], [4,3], [4,3,2], [4,3,3], [4,3,3,1], [4,3,3,2], [4,3,3,3,1],
    [4,3,3,3,2], [4,3,3,3,2,1], [4,3,3,3,2,1], [4,3,3,3,2,1,1], [4,3,3,3,2,1,1],
    [4,3,3,3,2,1,1,1], [4,3,3,3,2,1,1,1], [4,3,3,3,2,1,1,1,1],
    [4,3,3,3,3,1,1,1,1], [4,3,3,3,3,2,1,1,1], [4,3,3,3,3,2,2,1,1]
  ];
  const halfSlots = [
    [], [], [2], [3], [3], [4,2], [4,2], [4,3], [4,3], [4,3,2], [4,3,2],
    [4,3,3], [4,3,3], [4,3,3,1], [4,3,3,1], [4,3,3,2], [4,3,3,2],
    [4,3,3,3,1], [4,3,3,3,1], [4,3,3,3,2], [4,3,3,3,2]
  ];

  const classes = {
    barbarian: { name: "Варвар", hitDie: 12, saves: ["str","con"], caster: "none", armor: "Лёгкие и средние доспехи, щиты", weapons: "Простое и воинское оружие", resources: level => [{ name:"Ярость", max: level >= 20 ? 999 : [0,2,2,3,3,3,4,4,4,4,4,4,5,5,5,5,5,6,6,6,6][level], reset:"long" }] },
    bard: { name: "Бард", hitDie: 8, saves: ["dex","cha"], caster: "full", spellAbility: "cha", armor: "Лёгкие доспехи", weapons: "Простое оружие, ручные арбалеты, длинные и короткие мечи, рапиры", resources: (_level, sheet) => [{ name:"Бардовское вдохновение", max: Math.max(1, Math.floor((Number(sheet.stats?.cha || 10)-10)/2)), reset: Number(sheet.level) >= 5 ? "short" : "long" }] },
    cleric: { name: "Жрец", hitDie: 8, saves: ["wis","cha"], caster: "full", spellAbility: "wis", armor: "Лёгкие и средние доспехи, щиты", weapons: "Простое оружие", resources: level => level < 2 ? [] : [{ name:"Божественный канал", max: level >= 18 ? 3 : level >= 6 ? 2 : 1, reset:"short" }] },
    druid: { name: "Друид", hitDie: 8, saves: ["int","wis"], caster: "full", spellAbility: "wis", armor: "Лёгкие и средние неметаллические доспехи, щиты", weapons: "Дубинки, кинжалы, дротики, копья, булавы, боевые посохи, пращи, серпы, скимитары", resources: level => level < 2 ? [] : [{ name:"Дикий облик", max: 2, reset:"short" }] },
    fighter: { name: "Воин", hitDie: 10, saves: ["str","con"], caster: "none", armor: "Все доспехи, щиты", weapons: "Простое и воинское оружие", resources: level => [{ name:"Второе дыхание", max:1, reset:"short" }, ...(level >= 2 ? [{ name:"Всплеск действий", max: level >= 17 ? 2 : 1, reset:"short" }] : []), ...(level >= 9 ? [{ name:"Несгибаемый", max: level >= 17 ? 3 : level >= 13 ? 2 : 1, reset:"long" }] : [])] },
    monk: { name: "Монах", hitDie: 8, saves: ["str","dex"], caster: "none", armor: "Нет", weapons: "Простое оружие, короткие мечи", resources: level => level < 2 ? [] : [{ name:"Ци", max:level, reset:"short" }] },
    paladin: { name: "Паладин", hitDie: 10, saves: ["wis","cha"], caster: "half", spellAbility: "cha", armor: "Все доспехи, щиты", weapons: "Простое и воинское оружие", resources: level => [{ name:"Наложение рук", max:level*5, reset:"long" }, ...(level >= 3 ? [{ name:"Божественный канал", max:1, reset:"short" }] : [])] },
    ranger: { name: "Следопыт", hitDie: 10, saves: ["str","dex"], caster: "half", spellAbility: "wis", armor: "Лёгкие и средние доспехи, щиты", weapons: "Простое и воинское оружие", resources: () => [] },
    rogue: { name: "Плут", hitDie: 8, saves: ["dex","int"], caster: "none", armor: "Лёгкие доспехи", weapons: "Простое оружие, ручные арбалеты, длинные и короткие мечи, рапиры", resources: level => level >= 20 ? [{ name:"Надёжная удача", max:1, reset:"short" }] : [] },
    sorcerer: { name: "Чародей", hitDie: 6, saves: ["con","cha"], caster: "full", spellAbility: "cha", armor: "Нет", weapons: "Кинжалы, дротики, пращи, боевые посохи, лёгкие арбалеты", resources: level => level < 2 ? [] : [{ name:"Единицы чародейства", max:level, reset:"long" }] },
    warlock: { name: "Колдун", hitDie: 8, saves: ["wis","cha"], caster: "pact", spellAbility: "cha", armor: "Лёгкие доспехи", weapons: "Простое оружие", resources: () => [] },
    wizard: { name: "Волшебник", hitDie: 6, saves: ["int","wis"], caster: "full", spellAbility: "int", armor: "Нет", weapons: "Кинжалы, дротики, пращи, боевые посохи, лёгкие арбалеты", resources: level => [{ name:"Магическое восстановление", max:Math.max(1, Math.ceil(level/2)), reset:"long" }] }
  };

  const races = {
    human: { name:"Человек", size:"Средний", speed:30, darkvision:0, traits:"Универсальность, дополнительный язык." },
    elf: { name:"Эльф", size:"Средний", speed:30, darkvision:60, traits:"Наследие фей, транс, обострённые чувства." },
    dwarf: { name:"Дварф", size:"Средний", speed:25, darkvision:60, traits:"Дварфская стойкость, знание камня, скорость не снижается тяжёлым доспехом." },
    halfling: { name:"Полурослик", size:"Маленький", speed:25, darkvision:0, traits:"Везучий, храбрый, проворство полурослика." },
    dragonborn: { name:"Драконорождённый", size:"Средний", speed:30, darkvision:0, traits:"Драконье наследие, дыхательное оружие и сопротивление стихии." },
    gnome: { name:"Гном", size:"Маленький", speed:25, darkvision:60, traits:"Гномья хитрость." },
    halfelf: { name:"Полуэльф", size:"Средний", speed:30, darkvision:60, traits:"Наследие фей, универсальность навыков." },
    halforc: { name:"Полуорк", size:"Средний", speed:30, darkvision:60, traits:"Угрожающий вид, неукротимая стойкость, свирепые атаки." },
    tiefling: { name:"Тифлинг", size:"Средний", speed:30, darkvision:60, traits:"Адское сопротивление и врождённая магия." },
    tabaxi: { name:"Табакси", size:"Средний", speed:30, darkvision:60, traits:"Кошачья ловкость, когти, талант к восприятию и скрытности." },
    custom: { name:"Своя раса", size:"Средний", speed:30, darkvision:0, traits:"" }
  };

  const weapons = [
    ["club","Дубинка","1d4","дробящий",2,"str","лёгкое"], ["dagger","Кинжал","1d4","колющий",1,"finesse","лёгкое, метательное"],
    ["greatclub","Палица","1d8","дробящий",10,"str","двуручное"], ["handaxe","Ручной топор","1d6","рубящий",2,"str","лёгкое, метательное"],
    ["javelin","Метательное копьё","1d6","колющий",2,"str","метательное"], ["mace","Булава","1d6","дробящий",4,"str",""],
    ["quarterstaff","Боевой посох","1d6","дробящий",4,"str","универсальное 1d8"], ["spear","Копьё","1d6","колющий",3,"str","метательное, универсальное 1d8"],
    ["light-crossbow","Лёгкий арбалет","1d8","колющий",5,"dex","боеприпас, перезарядка, двуручное"], ["shortbow","Короткий лук","1d6","колющий",2,"dex","боеприпас, двуручное"],
    ["battleaxe","Боевой топор","1d8","рубящий",4,"str","универсальное 1d10"], ["greatsword","Двуручный меч","2d6","рубящий",6,"str","тяжёлое, двуручное"],
    ["longsword","Длинный меч","1d8","рубящий",3,"str","универсальное 1d10"], ["maul","Молот","2d6","дробящий",10,"str","тяжёлое, двуручное"],
    ["rapier","Рапира","1d8","колющий",2,"finesse","фехтовальное"], ["scimitar","Скимитар","1d6","рубящий",3,"finesse","фехтовальное, лёгкое"],
    ["shortsword","Короткий меч","1d6","колющий",2,"finesse","фехтовальное, лёгкое"], ["warhammer","Боевой молот","1d8","дробящий",2,"str","универсальное 1d10"],
    ["hand-crossbow","Ручной арбалет","1d6","колющий",3,"dex","боеприпас, лёгкое, перезарядка"], ["longbow","Длинный лук","1d8","колющий",2,"dex","боеприпас, тяжёлое, двуручное"]
  ].map(([key,name,damage,damageType,weight,ability,properties]) => ({ key,name,type:"weapon",damage,damageType,weight,ability,properties }));

  const armor = [
    ["padded","Стёганый доспех",11,"light",8,true], ["leather","Кожаный доспех",11,"light",10,false], ["studded","Проклёпанная кожа",12,"light",13,false],
    ["hide","Шкурный доспех",12,"medium",12,false], ["chain-shirt","Кольчужная рубаха",13,"medium",20,false], ["scale","Чешуйчатый доспех",14,"medium",45,true],
    ["breastplate","Кираса",14,"medium",20,false], ["half-plate","Полулаты",15,"medium",40,true], ["ring-mail","Колечный доспех",14,"heavy",40,true],
    ["chain-mail","Кольчуга",16,"heavy",55,true], ["splint","Наборный доспех",17,"heavy",60,true], ["plate","Латы",18,"heavy",65,true],
    ["shield","Щит",2,"shield",6,false]
  ].map(([key,name,baseAc,armorType,weight,stealthDisadvantage]) => ({ key,name,type:"armor",baseAc,armorType,weight,stealthDisadvantage }));

  const gear = [
    ["backpack","Рюкзак",5], ["bedroll","Спальник",7], ["rope","Пеньковая верёвка, 50 футов",10], ["torch","Факел",1],
    ["rations","Рационы на день",2], ["waterskin","Бурдюк",5], ["healers-kit","Набор лекаря",3], ["thieves-tools","Воровские инструменты",1],
    ["arrows","Стрелы, 20",1], ["bolts","Арбалетные болты, 20",1], ["potion-healing","Зелье лечения",0.5]
  ].map(([key,name,weight]) => ({ key,name,type:"gear",weight }));

  const conditionInfo = {
    "Ослеплён":"Не видит; автоматически проваливает проверки зрения. Атаки существа с помехой, атаки по нему с преимуществом.",
    "Очарован":"Не может атаковать очаровавшего; тот имеет преимущество на социальные проверки против цели.",
    "Оглушён":"Недееспособен, не может двигаться, говорит прерывисто; проваливает спасброски Силы и Ловкости, атаки по нему с преимуществом.",
    "Отравлен":"Помеха на атаки и проверки характеристик.",
    "Испуган":"Помеха на атаки и проверки, пока источник страха виден; нельзя добровольно приближаться к нему.",
    "Схвачен":"Скорость становится 0. Состояние заканчивается при удалении схватившего из досягаемости.",
    "Недееспособен":"Не может совершать действия и реакции.",
    "Невидим":"Без специальных чувств не виден; атаки существа с преимуществом, атаки по нему с помехой.",
    "Парализован":"Недееспособен и не двигается; проваливает спасброски Силы и Ловкости. Атаки по нему с преимуществом, попадание в 5 футах — критическое.",
    "Окаменел":"Превращён в твёрдое вещество, недееспособен, не стареет; сопротивление всему урону и иммунитет к яду и болезням.",
    "Сбит с ног":"Только ползает; атаки существа с помехой. Атаки по нему в 5 футах с преимуществом, остальные — с помехой.",
    "Опутан":"Скорость 0; атаки существа с помехой, атаки по нему с преимуществом; помеха на спасброски Ловкости.",
    "Без сознания":"Недееспособен, не двигается и не осознаёт окружение; роняет предметы, падает; близкие попадания критические.",
    "Истощён":"Эффект зависит от уровня истощения и отображается отдельно в боевом разделе."
  };
  const exhaustionInfo = [
    "Нет истощения.",
    "Помеха на проверки характеристик.",
    "Скорость уменьшается вдвое.",
    "Помеха на броски атаки и спасброски.",
    "Максимум HP уменьшается вдвое.",
    "Скорость становится равной 0.",
    "Смерть."
  ];

  const classSkills = {
    barbarian:{ count:2, options:["animal","athletics","intimidation","nature","perception","survival"] },
    bard:{ count:3, options:["acrobatics","animal","arcana","athletics","deception","history","insight","intimidation","investigation","medicine","nature","perception","performance","persuasion","religion","sleight","stealth","survival"] },
    cleric:{ count:2, options:["history","insight","medicine","persuasion","religion"] },
    druid:{ count:2, options:["animal","arcana","insight","medicine","nature","perception","religion","survival"] },
    fighter:{ count:2, options:["acrobatics","animal","athletics","history","insight","intimidation","perception","survival"] },
    monk:{ count:2, options:["acrobatics","athletics","history","insight","religion","stealth"] },
    paladin:{ count:2, options:["athletics","insight","intimidation","medicine","persuasion","religion"] },
    ranger:{ count:3, options:["animal","athletics","insight","investigation","nature","perception","stealth","survival"] },
    rogue:{ count:4, options:["acrobatics","athletics","deception","insight","intimidation","investigation","perception","performance","persuasion","sleight","stealth"] },
    sorcerer:{ count:2, options:["arcana","deception","insight","intimidation","persuasion","religion"] },
    warlock:{ count:2, options:["arcana","deception","history","intimidation","investigation","nature","religion"] },
    wizard:{ count:2, options:["arcana","history","insight","investigation","medicine","religion"] }
  };

  function proficiency(level) { return 2 + Math.floor((Math.max(1, Number(level)||1)-1)/4); }
  function slotsFor(classKey, level) {
    const cls = classes[classKey]; level = Math.max(1, Math.min(20, Number(level)||1));
    if (!cls || cls.caster === "none") return [];
    if (cls.caster === "full") return fullSlots[level] || [];
    if (cls.caster === "half") return halfSlots[level] || [];
    if (cls.caster === "pact") {
      const slotLevel = Math.min(5, Math.ceil(level/2));
      const total = level === 1 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4;
      return Array.from({length:slotLevel}, (_,i) => i === slotLevel-1 ? total : 0);
    }
    return [];
  }
  function fixedHp(hitDie, level, conMod) {
    level = Math.max(1, Number(level)||1);
    return Math.max(level, hitDie + conMod + (level-1) * (Math.floor(hitDie/2)+1+conMod));
  }

  function preparedLimit(classKey, level, abilityMod) {
    level = Math.max(1, Math.min(20, Number(level) || 1));
    abilityMod = Number(abilityMod || 0);
    if (["cleric","druid","wizard"].includes(classKey)) return Math.max(1, level + abilityMod);
    if (classKey === "paladin") return Math.max(1, Math.floor(level / 2) + abilityMod);
    return null;
  }

  function pointBuyTotal(stats) {
    const price = { 8:0, 9:1, 10:2, 11:3, 12:4, 13:5, 14:7, 15:9 };
    const values = Object.values(stats || {}).map(Number);
    if (values.some(value => !(value in price))) return null;
    return values.reduce((sum, value) => sum + price[value], 0);
  }

  function sneakAttackDice(level) { return Math.max(1, Math.ceil((Math.max(1, Number(level) || 1)) / 2)); }

  window.TT_RULES = { classes, races, weapons, armor, gear, conditionInfo, exhaustionInfo, classSkills, proficiency, slotsFor, fixedHp, preparedLimit, pointBuyTotal, sneakAttackDice };
})();
