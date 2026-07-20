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
    human: { name:"Человек", size:"Средний", speed:30, darkvision:0, bonuses:{str:1,dex:1,con:1,int:1,wis:1,cha:1}, languages:"Общий и ещё один язык", traits:"Универсальность, дополнительный язык." },
    elf: { name:"Эльф", size:"Средний", speed:30, darkvision:60, bonuses:{dex:2}, languages:"Общий, Эльфийский", skills:["perception"], traits:"Наследие фей, транс, обострённые чувства." },
    dwarf: { name:"Дварф", size:"Средний", speed:25, darkvision:60, bonuses:{con:2}, languages:"Общий, Дварфский", traits:"Дварфская стойкость, знание камня, скорость не снижается тяжёлым доспехом." },
    halfling: { name:"Полурослик", size:"Маленький", speed:25, darkvision:0, bonuses:{dex:2}, languages:"Общий, Полуросличий", traits:"Везучий, храбрый, проворство полурослика." },
    dragonborn: { name:"Драконорождённый", size:"Средний", speed:30, darkvision:0, bonuses:{str:2,cha:1}, languages:"Общий, Драконий", traits:"Драконье наследие, дыхательное оружие и сопротивление стихии." },
    gnome: { name:"Гном", size:"Маленький", speed:25, darkvision:60, bonuses:{int:2}, languages:"Общий, Гномий", traits:"Гномья хитрость." },
    halfelf: { name:"Полуэльф", size:"Средний", speed:30, darkvision:60, bonuses:{cha:2}, flexible:[1,1], excludeFlexible:["cha"], languages:"Общий, Эльфийский и ещё один язык", traits:"Наследие фей, универсальность навыков." },
    halforc: { name:"Полуорк", size:"Средний", speed:30, darkvision:60, bonuses:{str:2,con:1}, languages:"Общий, Орочий", skills:["intimidation"], traits:"Угрожающий вид, неукротимая стойкость, свирепые атаки." },
    tiefling: { name:"Тифлинг", size:"Средний", speed:30, darkvision:60, bonuses:{cha:2,int:1}, languages:"Общий, Инфернальный", traits:"Адское сопротивление и врождённая магия." },
    tabaxi: { name:"Табакси", size:"Средний", speed:30, darkvision:60, bonuses:{dex:2,cha:1}, languages:"Общий и ещё один язык", skills:["perception","stealth"], traits:"Кошачья ловкость, когти, талант к восприятию и скрытности." },
    custom: { name:"Своя раса", size:"Средний", speed:30, darkvision:0, bonuses:{}, flexible:[2,1], languages:"Общий и ещё один язык", traits:"Собственное происхождение." }
  };

  const subclasses = {
    barbarian:["Путь берсерка","Путь тотемного воина"], bard:["Коллегия знаний","Коллегия доблести"],
    cleric:["Домен жизни","Домен света","Домен войны","Домен знаний","Домен природы","Домен бури","Домен обмана"],
    druid:["Круг земли","Круг луны"], fighter:["Чемпион","Мастер боевых искусств","Мистический рыцарь"],
    monk:["Путь открытой ладони","Путь тени","Путь четырёх стихий"], paladin:["Клятва преданности","Клятва древних","Клятва мести"],
    ranger:["Охотник","Повелитель зверей"], rogue:["Вор","Убийца","Мистический ловкач"],
    sorcerer:["Наследие драконьей крови","Дикая магия"], warlock:["Архифея","Исчадие","Великий Древний"],
    wizard:["Школа ограждения","Школа вызова","Школа воплощения","Школа иллюзии","Школа некромантии","Школа очарования","Школа прорицания","Школа преобразования"]
  };
  const subclassLevels = { cleric:1, sorcerer:1, warlock:1, druid:2, wizard:2 };

  const backgrounds = {
    acolyte:{ name:"Прислужник", skills:["insight","religion"], tools:"—", languages:"Два дополнительных языка", item:"Священный символ", summary:"Служение храму, знание религии и людей." },
    charlatan:{ name:"Шарлатан", skills:["deception","sleight"], tools:"Набор для грима, набор для подделки", languages:"—", item:"Набор для грима", summary:"Ложная личность, обман и ловкость рук." },
    criminal:{ name:"Преступник", skills:["deception","stealth"], tools:"Воровские инструменты, игровой набор", languages:"—", item:"Воровские инструменты", summary:"Связи в преступном мире и скрытность." },
    entertainer:{ name:"Артист", skills:["acrobatics","performance"], tools:"Набор для грима, музыкальный инструмент", languages:"—", item:"Музыкальный инструмент", summary:"Сцена, публика и умение привлечь внимание." },
    folkhero:{ name:"Народный герой", skills:["animal","survival"], tools:"Ремесленный инструмент, наземный транспорт", languages:"—", item:"Ремесленные инструменты", summary:"Защитник простых людей, привычный к дороге." },
    guildartisan:{ name:"Гильдейский ремесленник", skills:["insight","persuasion"], tools:"Один ремесленный инструмент", languages:"Один дополнительный язык", item:"Ремесленные инструменты", summary:"Мастер своего дела с гильдейскими связями." },
    hermit:{ name:"Отшельник", skills:["medicine","religion"], tools:"Набор травника", languages:"Один дополнительный язык", item:"Набор травника", summary:"Уединение, лечение и найденное откровение." },
    noble:{ name:"Благородный", skills:["history","persuasion"], tools:"Один игровой набор", languages:"Один дополнительный язык", item:"Кольцо-печатка", summary:"Положение в обществе и знатные связи." },
    outlander:{ name:"Чужеземец", skills:["athletics","survival"], tools:"Один музыкальный инструмент", languages:"Один дополнительный язык", item:"Охотничий трофей", summary:"Путешественник, привычный к дикой местности." },
    sage:{ name:"Мудрец", skills:["arcana","history"], tools:"—", languages:"Два дополнительных языка", item:"Чернильница и перо", summary:"Исследователь, который знает, где искать ответ." },
    sailor:{ name:"Моряк", skills:["athletics","perception"], tools:"Инструменты навигатора, водный транспорт", languages:"—", item:"Верёвка", summary:"Морская закалка, наблюдательность и корабельные связи." },
    soldier:{ name:"Солдат", skills:["athletics","intimidation"], tools:"Один игровой набор, наземный транспорт", languages:"—", item:"Знак воинского звания", summary:"Военная служба, дисциплина и авторитет." },
    urchin:{ name:"Беспризорник", skills:["sleight","stealth"], tools:"Воровские инструменты, набор для грима", languages:"—", item:"Маленький нож", summary:"Городские улицы, тайные проходы и выживание." }
  };

  const statPriorities = {
    barbarian:["str","con","dex","wis","cha","int"], bard:["cha","dex","con","wis","int","str"], cleric:["wis","con","str","dex","cha","int"],
    druid:["wis","con","dex","int","cha","str"], fighter:["str","con","dex","wis","cha","int"], monk:["dex","wis","con","str","int","cha"],
    paladin:["str","cha","con","wis","dex","int"], ranger:["dex","wis","con","str","int","cha"], rogue:["dex","con","cha","wis","int","str"],
    sorcerer:["cha","con","dex","wis","int","str"], warlock:["cha","con","dex","wis","int","str"], wizard:["int","con","dex","wis","cha","str"]
  };

  const startingKits = {
    barbarian:["greatsword","handaxe","backpack"], bard:["rapier","leather","dagger","backpack"], cleric:["mace","scale","shield","backpack"],
    druid:["scimitar","leather","shield","backpack"], fighter:["longsword","chain-mail","shield","light-crossbow","backpack"],
    monk:["quarterstaff","dagger","backpack"], paladin:["longsword","chain-mail","shield","backpack"], ranger:["longbow","leather","shortsword","backpack"],
    rogue:["rapier","shortbow","leather","thieves-tools","backpack"], sorcerer:["light-crossbow","dagger","backpack"],
    warlock:["light-crossbow","leather","dagger","backpack"], wizard:["quarterstaff","dagger","backpack"]
  };

  const recommendedSpells = {
    bard:["vicious-mockery","mage-hand","healing-word","faerie-fire"], cleric:["sacred-flame","guidance","bless","healing-word"],
    druid:["produce-flame","guidance","entangle","healing-word"], paladin:["bless","cure-wounds"], ranger:["hunters-mark","cure-wounds"],
    sorcerer:["fire-bolt","mage-hand","magic-missile","shield"], warlock:["eldritch-blast","minor-illusion","armor-of-agathys","charm-person"],
    wizard:["fire-bolt","mage-hand","minor-illusion","magic-missile","shield","detect-magic"]
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

  const asiLevels = {
    fighter:[4,6,8,12,14,16,19],
    rogue:[4,8,10,12,16,19],
    default:[4,8,12,16,19]
  };

  const multiclassRequirements = {
    barbarian:[["str",13]], bard:[["cha",13]], cleric:[["wis",13]], druid:[["wis",13]],
    fighter:[[["str",13],["dex",13]]], monk:[["dex",13],["wis",13]],
    paladin:[["str",13],["cha",13]], ranger:[["dex",13],["wis",13]], rogue:[["dex",13]],
    sorcerer:[["cha",13]], warlock:[["cha",13]], wizard:[["int",13]]
  };

  const feats = {
    alert:{ name:"Бдительный", summary:"+5 к инициативе; напоминает о защите от внезапности." },
    tough:{ name:"Крепкий", summary:"Максимум HP увеличивается на 2 за каждый общий уровень." },
    mobile:{ name:"Подвижный", summary:"Скорость увеличивается на 10 футов; дополнительные боевые преимущества отмечаются в памятке." },
    observant:{ name:"Наблюдательный", summary:"+1 к Интеллекту или Мудрости и +5 к пассивному Восприятию и Анализу.", abilityChoices:["int","wis"] },
    resilient:{ name:"Стойкий", summary:"+1 к выбранной характеристике и владение соответствующим спасброском.", abilityChoices:["str","dex","con","int","wis","cha"] },
    athlete:{ name:"Атлет", summary:"+1 к Силе или Ловкости и памятка о более уверенном движении.", abilityChoices:["str","dex"] },
    actor:{ name:"Актёр", summary:"+1 к Харизме и памятка о подражании и игре роли.", abilityChoices:["cha"] },
    durable:{ name:"Выносливый", summary:"+1 к Телосложению и улучшенное восстановление костями хитов.", abilityChoices:["con"] },
    keenmind:{ name:"Острый ум", summary:"+1 к Интеллекту и памятка об ориентации и памяти.", abilityChoices:["int"] },
    linguist:{ name:"Лингвист", summary:"+1 к Интеллекту; добавь выбранные языки в раздел владений.", abilityChoices:["int"] },
    lucky:{ name:"Везунчик", summary:"Три очка удачи на долгий отдых; ресурс будет добавлен в лист." },
    skilled:{ name:"Умелец", summary:"Выбери три дополнительных навыка или инструмента; выбор отмечается в листе." },
    sentinel:{ name:"Страж", summary:"Боевые реакции и контроль противников; автоматизация появится на карте." },
    sharpshooter:{ name:"Меткий стрелок", summary:"Дальние атаки и рискованный мощный выстрел; включай модификатор в нужной атаке." },
    greatweapon:{ name:"Мастер тяжёлого оружия", summary:"Особые возможности тяжёлого оружия; включай модификатор в нужной атаке." },
    warcaster:{ name:"Боевой заклинатель", summary:"Преимущества при поддержании концентрации и колдовстве в ближнем бою." },
    dualwielder:{ name:"Дуэлянт с двумя оружиями", summary:"Улучшает бой парным оружием; детали хранятся в памятке." },
    crossbow:{ name:"Эксперт по арбалетам", summary:"Снимает часть ограничений арбалетов и помогает в ближнем бою." },
    magicinitiate:{ name:"Посвящённый в магию", summary:"Добавь выбранные заговоры и заклинание через справочник гримуара." }
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
  function pactSlotsFor(level) {
    level = Math.max(0, Math.min(20, Number(level) || 0));
    if (!level) return { level:0, total:0 };
    return { level:Math.min(5, Math.ceil(level / 2)), total:level === 1 ? 1 : level < 11 ? 2 : level < 17 ? 3 : 4 };
  }
  function levelsForAsi(classKey) { return asiLevels[classKey] || asiLevels.default; }
  function isAsiLevel(classKey, classLevel) { return levelsForAsi(classKey).includes(Number(classLevel)); }
  function meetsRequirement(classKey, stats = {}) {
    const groups = multiclassRequirements[classKey] || [];
    return groups.every(group => {
      if (Array.isArray(group[0])) return group.some(([ability, score]) => Number(stats[ability] || 0) >= score);
      const [ability, score] = group;
      return Number(stats[ability] || 0) >= score;
    });
  }
  function requirementText(classKey) {
    const names = { str:"Сила", dex:"Ловкость", con:"Телосложение", int:"Интеллект", wis:"Мудрость", cha:"Харизма" };
    return (multiclassRequirements[classKey] || []).map(group => {
      if (Array.isArray(group[0])) return group.map(([ability, score]) => `${names[ability]} ${score}`).join(" или ");
      return `${names[group[0]]} ${group[1]}`;
    }).join(" и ") || "без требований";
  }
  function multiclassSpellcasting(entries = []) {
    let casterLevel = 0;
    let halfCombined = 0;
    let thirdCombined = 0;
    let warlockLevel = 0;
    entries.forEach(entry => {
      const key = entry.key || entry.classKey;
      const level = Math.max(0, Number(entry.level) || 0);
      const cls = classes[key];
      if (!cls || !level) return;
      if (cls.caster === "full") casterLevel += level;
      else if (cls.caster === "half") halfCombined += level;
      else if (cls.caster === "pact") warlockLevel += level;
      else if ((key === "fighter" && entry.subclass === "Мистический рыцарь") || (key === "rogue" && entry.subclass === "Мистический ловкач")) thirdCombined += level;
    });
    casterLevel += Math.floor(halfCombined / 2) + Math.floor(thirdCombined / 3);
    casterLevel = Math.min(20, casterLevel);
    return { casterLevel, slots:fullSlots[casterLevel] || [], pact:pactSlotsFor(warlockLevel) };
  }
  function hitDicePoolsFor(entries = [], previous = []) {
    const totals = new Map();
    entries.forEach(entry => {
      const sides = Number(entry.hitDie || classes[entry.key || entry.classKey]?.hitDie || 8);
      totals.set(sides, (totals.get(sides) || 0) + Math.max(0, Number(entry.level) || 0));
    });
    return [...totals.entries()].sort((a,b) => b[0] - a[0]).map(([sides,total]) => {
      const old = previous.find(pool => Number(pool.sides) === sides);
      const spent = old ? Math.max(0, Number(old.total) - Number(old.current)) : 0;
      return { sides, total, current:Math.max(0, total - spent) };
    });
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

  function abilityBuild(classKey, raceKey, level = 1) {
    const priority = statPriorities[classKey] || ["str","dex","con","int","wis","cha"];
    const base = Object.fromEntries(priority.map((ability, index) => [ability, [15,14,13,12,10,8][index]]));
    const race = races[raceKey] || races.custom;
    const bonuses = { str:0, dex:0, con:0, int:0, wis:0, cha:0, ...(race.bonuses || {}) };
    const blocked = new Set(race.excludeFlexible || []);
    const available = priority.filter(ability => !blocked.has(ability));
    (race.flexible || []).forEach((bonus, index) => {
      const ability = available[index] || priority[index] || "str";
      bonuses[ability] += Number(bonus || 0);
    });
    const total = Object.fromEntries(Object.keys(bonuses).map(ability => [ability, Number(base[ability] || 8) + Number(bonuses[ability] || 0)]));
    const improvementLevels = classKey === "fighter" ? [4,6,8,12,14,16,19] : classKey === "rogue" ? [4,8,10,12,16,19] : [4,8,12,16,19];
    const levelBonuses = { str:0, dex:0, con:0, int:0, wis:0, cha:0 };
    const advancements = [];
    improvementLevels.filter(unlock => Number(level) >= unlock).forEach(unlock => {
      let points = 2;
      const abilityIncreases = {};
      priority.forEach(ability => {
        const added = Math.min(points, Math.max(0, 20 - total[ability]));
        total[ability] += added; levelBonuses[ability] += added; points -= added;
        if (added) abilityIncreases[ability] = added;
      });
      advancements.push({ classKey, classLevel:unlock, type:"asi", abilityIncreases, recommended:true });
    });
    return { base, bonuses, levelBonuses, total, advancements };
  }

  function subclassLevel(classKey) { return subclassLevels[classKey] || 3; }

  window.TT_RULES = { classes, races, subclasses, backgrounds, statPriorities, startingKits, recommendedSpells, weapons, armor, gear, conditionInfo, exhaustionInfo, classSkills, feats, asiLevels, multiclassRequirements, proficiency, slotsFor, pactSlotsFor, multiclassSpellcasting, hitDicePoolsFor, levelsForAsi, isAsiLevel, meetsRequirement, requirementText, fixedHp, preparedLimit, pointBuyTotal, sneakAttackDice, abilityBuild, subclassLevel };
})();
