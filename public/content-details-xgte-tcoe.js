/* TabaxiTable 2.3: механические данные XGtE/TCoE.
   Полные тексты книг не копируются: только названия, уровни, числовые параметры
   и короткие авторские памятки для работы листа и VTT. */
(function () {
  const packs = window.TT_CONTENT_PACKS || {};
  const xgte = packs.xgte;
  const tcoe = packs.tcoe;
  if (!xgte || !tcoe) return;

  const feature = (key, name, level, summary, extra = {}) => ({ key, name, level, summary, ...extra });
  const optional = (key, name, level, summary, extra = {}) => ({ key, name, level, summary, source:"tcoe", ...extra });
  const infusion = (key, name, level, summary, extra = {}) => ({ key, name, level, summary, source:"tcoe", ...extra });
  const resource = (name, max, reset = "long", extra = {}) => ({ name, max, reset, ...extra });

  /* В XGtE нет новых игровых рас. TCoE добавляет отдельную «Особую родословную»
     и опциональную перенастройку происхождения для уже существующих рас. */
  tcoe.races = {
    customlineage:{
      name:"Особая родословная",
      originalName:"Custom Lineage",
      source:"tcoe",
      size:"Средний",
      sizeChoices:["Маленький","Средний"],
      speed:30,
      darkvision:0,
      bonuses:{},
      flexible:[2],
      languages:"Общий и ещё один язык",
      skills:[],
      traits:"Гибкое происхождение: +2 к одной характеристике, черта на 1 уровне и выбор тёмного зрения либо владения навыком.",
      customLineage:true,
      lineageTalentChoices:["darkvision","skill"]
    }
  };
  tcoe.originRules = {
    id:"tashas-origin",
    name:"Настройка происхождения",
    summary:"Переносит расовые бонусы характеристик и позволяет заменить врождённые владения, не меняя остальные особенности расы.",
    abilityBonusesDistinct:true
  };

  Object.assign(xgte.feats.bountifulluck,{ raceKeys:["halfling"] });
  Object.assign(xgte.feats.dragonfear,{ raceKeys:["dragonborn"] });
  Object.assign(xgte.feats.dragonhide,{ raceKeys:["dragonborn"] });
  Object.assign(xgte.feats.drowhighmagic,{ raceTags:["drow"] });
  Object.assign(xgte.feats.dwarvenfortitude,{ raceKeys:["dwarf"] });
  Object.assign(xgte.feats.elvenaccuracy,{ raceKeys:["elf","halfelf","highelf","woodelf","drow"], minimumAbility:13 });
  Object.assign(xgte.feats.fadeaway,{ raceKeys:["gnome"] });
  Object.assign(xgte.feats.feyteleportation,{ raceTags:["high-elf"] });
  Object.assign(xgte.feats.flamesofphlegethos,{ raceKeys:["tiefling"] });
  Object.assign(xgte.feats.infernalconstitution,{ raceKeys:["tiefling"] });
  Object.assign(xgte.feats.orcishfury,{ raceKeys:["halforc"] });
  Object.assign(xgte.feats.prodigy,{ raceKeys:["human","halfelf","halforc"] });
  Object.assign(xgte.feats.secondchance,{ raceKeys:["halfling"] });
  Object.assign(xgte.feats.squatnimbleness,{ raceKeys:["dwarf","gnome","halfling"] });
  Object.assign(xgte.feats.woodelfmagic,{ raceTags:["wood-elf"] });

  Object.assign(tcoe.feats.eldritchadept,{ prerequisite:"spellcasting-or-pact" });
  Object.assign(tcoe.feats.fightinginitiate,{ prerequisite:"martial-weapon" });
  Object.assign(tcoe.feats.metamagicadept,{ prerequisite:"spellcasting" });
  Object.assign(tcoe.feats.artificerinitiate,{ grantedSpells:1, grantedCantrips:1 });
  Object.assign(tcoe.feats.chef,{ resource:{ name:"Угощения шеф-повара", maxFormula:"proficiency", reset:"long" } });
  Object.assign(tcoe.feats.metamagicadept,{ resource:{ name:"Единицы чародейства от черты", max:2, reset:"long" } });
  Object.assign(tcoe.feats.poisoner,{ resource:{ name:"Дозы сильного яда", maxFormula:"proficiency", reset:"long" } });

  tcoe.optionalClassFeatures = {
    barbarian:[
      optional("primal-knowledge","Первобытное знание",3,"Получаешь дополнительный навык варвара; ещё один открывается на 10 уровне.",{ grantsSkill:true }),
      optional("instinctive-pounce","Инстинктивный бросок",7,"При входе в ярость можешь переместиться на половину скорости.")
    ],
    bard:[
      optional("additional-bard-spells","Дополнительные заклинания барда",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("magical-inspiration","Магическое вдохновение",2,"Кость вдохновения может усилить урон или лечение заклинания."),
      optional("bardic-versatility","Бардовская универсальность",4,"На уровне улучшения характеристик можно заменить навык с компетентностью или заговор.")
    ],
    cleric:[
      optional("additional-cleric-spells","Дополнительные заклинания жреца",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("harness-divine-power-cleric","Божественный канал: восстановление ячейки",2,"Тратит Божественный канал и возвращает ячейку ограниченного круга."),
      optional("cantrip-versatility-cleric","Универсальность заговоров",4,"На уровне улучшения характеристик можно заменить заговор."),
      optional("blessed-strikes","Благословенные удары",8,"Раз за ход добавляет 1к8 к урону оружием или заговором.",{ replaces:["Божественный удар","Могущественное колдовство"], combatFormula:"1к8" })
    ],
    druid:[
      optional("additional-druid-spells","Дополнительные заклинания друида",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("wild-companion","Дикий спутник",2,"Тратит Дикий облик, чтобы временно призвать фамильяра."),
      optional("cantrip-versatility-druid","Универсальность заговоров",4,"На уровне улучшения характеристик можно заменить заговор.")
    ],
    fighter:[
      optional("fighting-style-options-fighter","Дополнительные боевые стили",1,"Открывает новые варианты боевого стиля."),
      optional("martial-versatility-fighter","Воинская универсальность",4,"На уровне улучшения характеристик можно заменить стиль или известный приём."),
      optional("maneuver-options","Дополнительные боевые приёмы",3,"Добавляет новые приёмы для Мастера боевых искусств.")
    ],
    monk:[
      optional("dedicated-weapon","Посвящённое оружие",2,"После отдыха выбранное подходящее оружие считается монашеским."),
      optional("ki-fueled-attack","Быстрая атака оружием",3,"После траты ци действием можно атаковать бонусным действием."),
      optional("quickened-healing","Ускоренное лечение",4,"Тратит 2 ци, чтобы восстановить кость боевых искусств + мастерство HP.",{ combatFormula:"martial+proficiency", rollKind:"healing" }),
      optional("focused-aim","Сосредоточенный удар",5,"После промаха тратит 1–3 ци и повышает бросок атаки на 2 за каждую единицу.")
    ],
    paladin:[
      optional("additional-paladin-spells","Дополнительные заклинания паладина",2,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("blessed-warrior","Благословенный воин",2,"Боевой стиль даёт два заговора жреца."),
      optional("harness-divine-power-paladin","Божественный канал: восстановление ячейки",3,"Тратит Божественный канал и возвращает ячейку ограниченного круга."),
      optional("martial-versatility-paladin","Воинская универсальность",4,"На уровне улучшения характеристик можно заменить боевой стиль.")
    ],
    ranger:[
      optional("deft-explorer","Искусный исследователь",1,"Заменяет Исследователя природы: даёт компетентность и языки, затем скорость и временные HP.",{ replacement:"natural-explorer" }),
      optional("favored-foe","Избранный враг",1,"Заменяет Избранного врага: помеченная цель получает дополнительный урон.",{ replacement:"favored-enemy", combatFormula:"1к4" }),
      optional("additional-ranger-spells","Дополнительные заклинания следопыта",2,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("druidic-warrior","Друидический воин",2,"Боевой стиль даёт два заговора друида."),
      optional("spellcasting-focus-ranger","Фокус заклинаний",2,"Позволяет использовать друидический фокус для заклинаний следопыта."),
      optional("primal-awareness","Первобытная осведомлённость",3,"Заменяет Древнюю осведомлённость и даёт тематические заклинания по уровням.",{ replacement:"primeval-awareness" }),
      optional("primal-companion","Первобытный спутник",3,"Для Повелителя зверей заменяет спутника следопыта масштабируемым духом зверя земли, моря или неба.",{ replacement:"rangers-companion", subclass:"Повелитель зверей", companion:"primal-companion" }),
      optional("martial-versatility-ranger","Воинская универсальность",4,"На уровне улучшения характеристик можно заменить боевой стиль."),
      optional("natures-veil","Природная завеса",10,"Заменяет Маскировку на виду: бонусным действием становишься невидимым до следующего хода.",{ replacement:"hide-in-plain-sight", resource:resource("Природная завеса","proficiency","long") })
    ],
    rogue:[ optional("steady-aim","Верный прицел",3,"Если не двигался, бонусным действием получаешь преимущество на следующую атаку и обнуляешь скорость.") ],
    sorcerer:[
      optional("additional-sorcerer-spells","Дополнительные заклинания чародея",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("metamagic-options","Дополнительная метамагия",3,"Открывает новые варианты метамагии."),
      optional("sorcerous-versatility","Чародейская универсальность",4,"На уровне улучшения характеристик можно заменить заговор или метамагию."),
      optional("magical-guidance","Магическое руководство",5,"После провала проверки тратит единицу чародейства и перебрасывает к20.")
    ],
    warlock:[
      optional("additional-warlock-spells","Дополнительные заклинания колдуна",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("pact-of-the-talisman","Договор талисмана",3,"Носитель талисмана добавляет к4 к проваленной проверке ограниченное число раз.",{ resource:resource("Помощь талисмана","proficiency","long") }),
      optional("eldritch-versatility","Таинственная универсальность",4,"На уровне улучшения характеристик можно заменить заговор, дар договора или мистический арканум."),
      optional("eldritch-invocation-options","Дополнительные воззвания",2,"Открывает новые таинственные воззвания.")
    ],
    wizard:[
      optional("additional-wizard-spells","Дополнительные заклинания волшебника",1,"Расширяет классовый список заклинаний.",{ spellExpansion:true }),
      optional("cantrip-formulas","Формулы заговоров",3,"После долгого отдыха можно заменить один заговор из книги.")
    ]
  };

  tcoe.expandedSpellClassKeys = {
    bard:["color-spray","command","aid","enlarge-reduce","mirror-image","intellect-fortress","mass-healing-word","slow","phantasmal-killer","rarys-telepathic-bond","heroes-feast","dream-of-the-blue-veil","prismatic-spray","antipathy-sympathy","prismatic-wall"],
    cleric:["aura-of-vitality","spirit-shroud","aura-of-life","aura-of-purity","summon-celestial","sunbeam","sunburst","power-word-heal"],
    druid:["protection-from-evil-and-good","augury","continual-flame","enlarge-reduce","summon-beast","aura-of-vitality","elemental-weapon","revivify","summon-fey","divination","fire-shield","summon-elemental","cone-of-cold","flesh-to-stone","symbol","incendiary-cloud"],
    paladin:["gentle-repose","prayer-of-healing","warding-bond","spirit-shroud","summon-celestial"],
    ranger:["entangle","searing-smite","aid","enhance-ability","gust-of-wind","magic-weapon","summon-beast","elemental-weapon","meld-into-stone","revivify","summon-fey","dominate-beast","summon-elemental","greater-restoration"],
    sorcerer:["booming-blade","green-flame-blade","lightning-lure","mind-sliver","sword-burst","grease","tasha-s-caustic-brew","flame-blade","flaming-sphere","magic-weapon","tasha-s-mind-whip","intellect-fortress","vampiric-touch","flame-strike"],
    warlock:["booming-blade","green-flame-blade","lightning-lure","mind-sliver","sword-burst","intellect-fortress","spirit-shroud","summon-fey","summon-shadowspawn","summon-undead","summon-aberration","mislead","planar-binding","teleportation-circle","summon-fiend","tasha-s-otherworldly-guise","dream-of-the-blue-veil","blade-of-disaster","gate","weird"],
    wizard:["booming-blade","green-flame-blade","lightning-lure","mind-sliver","sword-burst","tasha-s-caustic-brew","augury","enhance-ability","tasha-s-mind-whip","intellect-fortress","speak-with-dead","spirit-shroud","summon-fey","summon-shadowspawn","summon-undead","divination","summon-aberration","summon-construct","summon-elemental","summon-fiend","tasha-s-otherworldly-guise","dream-of-the-blue-veil","blade-of-disaster"]
  };

  tcoe.infusions = [
    infusion("arcane-propulsion-armor","Доспех магической тяги",14,"Настроенный доспех повышает скорость, заменяет отсутствующие конечности и получает силовые перчатки.",{ itemType:"armor" }),
    infusion("armor-of-magical-strength","Доспех магической силы",2,"Доспех получает заряды, помогающие проверкам и спасброскам Силы.",{ itemType:"armor", charges:6 }),
    infusion("boots-of-the-winding-path","Сапоги извилистого пути",6,"Бонусным действием возвращают в недавнее свободное место.",{ itemType:"boots" }),
    infusion("enhanced-arcane-focus","Улучшенный магический фокус",2,"Даёт бонус к атакам заклинаниями; усиливается на 10 уровне.",{ itemType:"focus", bonusAt:{2:1,10:2} }),
    infusion("enhanced-defense","Улучшенная защита",2,"Даёт бонус к КД доспеха или щита; усиливается на 10 уровне.",{ itemType:"armor", acBonusAt:{2:1,10:2} }),
    infusion("enhanced-weapon","Улучшенное оружие",2,"Даёт бонус к атакам и урону оружием; усиливается на 10 уровне.",{ itemType:"weapon", bonusAt:{2:1,10:2} }),
    infusion("helm-of-awareness","Шлем бдительности",10,"Даёт преимущество на инициативу и защищает от неожиданности.",{ itemType:"helmet" }),
    infusion("homunculus-servant","Слуга-гомункул",2,"Создаёт маленького магического помощника со своей карточкой и атакой.",{ companion:"homunculus" }),
    infusion("mind-sharpener","Обостритель разума",2,"Одежда или доспех получает заряды для автоматического успеха концентрации.",{ itemType:"armor", charges:4 }),
    infusion("radiant-weapon","Сияющее оружие",6,"Оружие даёт +1 и может ослепить напавшего врага реакцией.",{ itemType:"weapon", bonus:1, charges:4 }),
    infusion("repeating-shot","Повторный выстрел",2,"Дальнобойное оружие получает +1, игнорирует перезарядку и создаёт боеприпасы.",{ itemType:"ranged-weapon", bonus:1 }),
    infusion("replicate-magic-item","Воспроизведение магического предмета",2,"Создаёт выбранный разрешённый магический предмет.",{ replicate:true }),
    infusion("repulsion-shield","Отталкивающий щит",6,"Щит даёт +1 КД и может оттолкнуть попавшего врага.",{ itemType:"shield", acBonus:1, charges:4 }),
    infusion("resistant-armor","Стойкий доспех",6,"Доспех даёт выбранное сопротивление урону.",{ itemType:"armor", choice:"damage-type" }),
    infusion("returning-weapon","Возвращающееся оружие",2,"Метательное оружие получает +1 и возвращается после атаки.",{ itemType:"thrown-weapon", bonus:1 }),
    infusion("spell-refueling-ring","Кольцо восстановления заклинаний",6,"Раз за долгий отдых возвращает потраченную ячейку до 3 круга.",{ itemType:"ring", charges:1 })
  ];

  const tracks = {
    barbarian:{
      "Путь предка-хранителя":[feature("ancestral-protectors","Защитники предков",3,"Первая поражённая в ярости цель хуже атакует союзников."),feature("spirit-shield","Щит духов",6,"Реакцией уменьшает урон союзнику рядом."),feature("consult-spirits","Совет духов",10,"Позволяет получать пророческую помощь духов."),feature("vengeful-ancestors","Мстительные предки",14,"Щит духов одновременно ранит атакующего.")],
      "Путь штормового вестника":[feature("storm-aura","Аура бури",3,"Выбирает пустыню, море или тундру и активирует ауру во время ярости.",{choice:true}),feature("storm-soul","Душа бури",6,"Получает стихийную защиту выбранной среды."),feature("shielding-storm","Защитная буря",10,"Передаёт сопротивление союзникам в ауре."),feature("raging-storm","Яростная буря",14,"Аура получает сильный ответный эффект.")],
      "Путь фанатика":[feature("divine-fury","Божественная ярость",3,"Раз за ход добавляет урон излучением или некротикой.",{combatFormula:"1к6+classLevel/2"}),feature("warrior-of-gods","Воин богов",3,"Возвращение к жизни не требует материального компонента."),feature("fanatical-focus","Фанатичная сосредоточенность",6,"Раз за ярость перебрасывает проваленный спасбросок."),feature("zealous-presence","Ревностное присутствие",10,"Раз за долгий отдых вдохновляет группу."),feature("rage-beyond-death","Ярость за гранью смерти",14,"Продолжает действовать при 0 HP, пока длится ярость.")],
      "Путь зверя":[feature("form-of-the-beast","Облик зверя",3,"В ярости выбирает укус, когти или хвост как природное оружие.",{choice:true}),feature("bestial-soul","Звериная душа",6,"Природное оружие становится магическим и даёт особое движение."),feature("infectious-fury","Заразительная ярость",10,"Удар может заставить цель атаковать или получить психический урон."),feature("call-the-hunt","Зов охоты",14,"Усиливает союзников временными HP и дополнительным уроном.")],
      "Путь дикой магии":[feature("magic-awareness","Чувство магии",3,"Обнаруживает заклинания и магические предметы рядом."),feature("wild-surge","Всплеск дикой магии",3,"При входе в ярость бросает эффект по таблице."),feature("bolstering-magic","Поддерживающая магия",6,"Даёт союзнику к3 к проверкам или возвращает ячейку."),feature("unstable-backlash","Нестабильная отдача",10,"Реакцией меняет всплеск после урона."),feature("controlled-surge","Управляемый всплеск",14,"Бросает два эффекта и выбирает один.")]
    },
    bard:{
      "Коллегия очарования":[feature("mantle-inspiration","Мантия вдохновения",3,"Тратит вдохновение, выдаёт временные HP и перемещение реакцией."),feature("enthralling-performance","Завораживающее выступление",3,"После выступления очаровывает слушателей."),feature("mantle-majesty","Мантия величия",6,"Временно позволяет каждый ход приказывать бонусным действием."),feature("unbreakable-majesty","Несокрушимое величие",14,"Заставляет врага пройти спасбросок перед атакой.")],
      "Коллегия мечей":[feature("bonus-proficiencies-swords","Дополнительные владения",3,"Средние доспехи и скимитары; оружие становится фокусом."),feature("fighting-style-swords","Боевой стиль",3,"Выбирает Дуэлянта или Бой двумя оружиями.",{choice:true}),feature("blade-flourish","Фигуры клинка",3,"После атаки тратит вдохновение на защитную, режущую или подвижную фигуру."),feature("extra-attack-swords","Дополнительная атака",6,"Атакует дважды действием Атака."),feature("masters-flourish","Фигура мастера",14,"Можно использовать к6 без траты вдохновения.")],
      "Коллегия шёпотов":[feature("psychic-blades","Психические клинки",3,"После попадания тратит вдохновение на психический урон.",{combatFormula:"2к6"}),feature("words-terror","Слова ужаса",3,"Разговор наедине внушает страх."),feature("mantle-whispers","Мантия шёпотов",6,"Крадёт тень умершего гуманоида и принимает его облик."),feature("shadow-lore","Знание теней",14,"Шантажирует цель магическим секретом.")],
      "Коллегия творения":[feature("mote-potential","Частица потенциала",3,"Бардовское вдохновение получает дополнительный эффект по типу броска."),feature("performance-creation","Представление творения",3,"Создаёт немагический предмет ограниченной стоимости."),feature("animating-performance","Оживляющее представление",6,"Оживляет предмет как танцующего спутника."),feature("creative-crescendo","Творческое крещендо",14,"Создаёт несколько предметов без обычного лимита стоимости.")],
      "Коллегия красноречия":[feature("silver-tongue","Серебряный язык",3,"Низкие броски Убеждения и Обмана считаются 10."),feature("unsettling-words","Тревожные слова",3,"Тратит вдохновение и уменьшает следующий спасбросок цели."),feature("unfailing-inspiration","Неугасимое вдохновение",6,"Неудачная кость вдохновения не теряется."),feature("universal-speech","Всеобщая речь",6,"Временно позволяет существам понимать барда."),feature("infectious-inspiration","Заразительное вдохновение",14,"После успешной кости вдохновения передаёт вдохновение другому союзнику реакцией.")]
    },
    cleric:{
      "Домен кузни":[feature("bonus-proficiencies-forge","Владения кузни",1,"Тяжёлые доспехи и кузнечные инструменты."),feature("blessing-forge","Благословение кузни",1,"После отдыха делает оружие или доспех +1."),feature("channel-artisans","Божественный канал: благословение ремесленника",2,"Создаёт металлический предмет из материалов."),feature("soul-forge","Душа кузни",6,"Получает сопротивление огню и +1 КД в тяжёлом доспехе."),feature("divine-strike-forge","Божественный удар",8,"Раз за ход добавляет огненный урон оружием.",{combatFormula:"1к8"}),feature("saint-forge","Святой кузни и огня",17,"Иммунитет к огню и сопротивление немагическому физическому урону в тяжёлом доспехе.")],
      "Домен могилы":[feature("circle-mortality","Круг смертности",1,"Лечение цели при 0 HP использует максимум костей."),feature("eyes-grave","Глаза могилы",1,"Чувствует нежить вокруг."),feature("channel-path-grave","Божественный канал: путь к могиле",2,"Следующая атака делает цель уязвимой ко всему урону попадания."),feature("sentinel-death-door","Страж у порога смерти",6,"Реакцией отменяет критическое попадание."),feature("potent-spellcasting-grave","Могущественное колдовство",8,"Добавляет Мудрость к урону заговора."),feature("keeper-souls","Хранитель душ",17,"Лечит себя или союзника, когда рядом умирает враг.")],
      "Домен порядка":[feature("bonus-proficiencies-order","Дополнительные владения",1,"Тяжёлые доспехи и Убеждение либо Запугивание."),feature("voice-authority","Глас власти",1,"Союзник, затронутый заклинанием, может атаковать реакцией."),feature("channel-orders-demand","Божественный канал: требование порядка",2,"Очаровывает и разоружает врагов вокруг."),feature("embodiment-law","Воплощение закона",6,"Ограниченное число чар можно накладывать бонусным действием."),feature("divine-strike-order","Божественный удар",8,"Раз за ход добавляет психический урон оружием.",{combatFormula:"1к8"}),feature("orders-wrath","Гнев порядка",17,"Божественный удар помечает цель для дополнительного урона союзника.")],
      "Домен мира":[feature("implement-peace","Орудие мира",1,"Получает владение Проницательностью, Выступлением или Убеждением."),feature("emboldening-bond","Укрепляющая связь",1,"Связывает союзников: раз за ход к4 к атаке, проверке или спасброску."),feature("channel-balm-peace","Божественный канал: бальзам мира",2,"Перемещается без провокаций и лечит встреченных союзников."),feature("protective-bond","Защитная связь",6,"Связанные союзники телепортируются и принимают урон друг за друга."),feature("potent-spellcasting-peace","Могущественное колдовство",8,"Добавляет Мудрость к урону заговора."),feature("expansive-bond","Расширенная связь",17,"Связь работает дальше и даёт сопротивление перенаправленному урону.")],
      "Сумеречный домен":[feature("eyes-night","Глаза ночи",1,"Получает дальнее тёмное зрение и может делиться им."),feature("vigilant-blessing","Бдительное благословение",1,"Даёт существу преимущество на следующую инициативу."),feature("channel-twilight-sanctuary","Божественный канал: сумеречное святилище",2,"Аура выдаёт временные HP или снимает очарование/испуг."),feature("steps-night","Шаги ночи",6,"В полумраке или темноте временно летает бонусным действием."),feature("divine-strike-twilight","Божественный удар",8,"Раз за ход добавляет излучающий урон оружием.",{combatFormula:"1к8"}),feature("twilight-shroud","Сумеречный покров",17,"Союзники в святилище получают половинное укрытие.")]
    },
    druid:{
      "Круг снов":[feature("balm-summer-court","Бальзам Летнего двора",2,"Пул к6 лечит союзника бонусным действием и даёт временные HP."),feature("hearth-moonlight-shadow","Очаг лунного света и тени",6,"Защищает лагерь во время отдыха."),feature("hidden-paths","Скрытые тропы",10,"Телепортирует себя или союзника."),feature("walker-dreams","Странник снов",14,"После отдыха позволяет телепортироваться или видеть далёкое место.")],
      "Круг пастыря":[feature("speech-woods","Речь леса",2,"Говорит с животными и сильванами."),feature("spirit-totem","Тотем духа",2,"Призывает ауру Медведя, Ястреба или Единорога.",{choice:true}),feature("mighty-summoner","Могущественный призыватель",6,"Призывы получают больше HP и магические атаки."),feature("guardian-spirit","Дух-хранитель",10,"Тотем лечит призванных существ."),feature("faithful-summons","Верные призывы",14,"При падении до 0 HP автоматически вызывает защитников.")],
      "Круг спор":[feature("halo-spores","Ореол спор",2,"Реакцией наносит некротический урон существу рядом.",{combatFormula:"1к4"}),feature("symbiotic-entity","Симбиотическая сущность",2,"Тратит Дикий облик на временные HP и усиление спор/оружия."),feature("fungal-infestation","Грибковое заражение",6,"Реакцией поднимает небольшого зомби."),feature("spreading-spores","Распространение спор",10,"Создаёт область спор на расстоянии."),feature("fungal-body","Грибковое тело",14,"Иммунитет к нескольким состояниям и критическим попаданиям.")],
      "Круг звёзд":[feature("star-map","Звёздная карта",2,"Даёт фокус, заговор и направляющий луч."),feature("starry-form","Звёздная форма",2,"Тратит Дикий облик на форму Лучника, Чаши или Дракона.",{choice:true}),feature("cosmic-omen","Космическое знамение",6,"Реакцией добавляет или вычитает к6 из броска рядом."),feature("twinkling-constellations","Мерцающие созвездия",10,"Формы усиливаются и переключаются каждый ход."),feature("full-of-stars","Полон звёзд",14,"В форме получает сопротивление физическому урону.")],
      "Круг лесного пожара":[feature("summon-wildfire-spirit","Призыв духа пожара",2,"Тратит Дикий облик и призывает духа со своей карточкой."),feature("enhanced-bond","Усиленная связь",6,"Дух усиливает огненный урон и лечение на к8."),feature("cauterizing-flames","Прижигающее пламя",10,"После смерти существа создаёт пламя, лечащее или ранящее."),feature("blazing-revival","Пылающее возрождение",14,"Раз за долгий отдых дух спасает от падения до 0 HP.")]
    },
    fighter:{
      "Мистический лучник":[feature("arcane-archer-lore","Знания мистического лучника",3,"Получает Тайны/Природу и заговор."),feature("arcane-shot","Мистический выстрел",3,"Два раза за отдых применяет выбранные магические стрелы."),feature("magic-arrow","Магическая стрела",7,"Стрелы считаются магическими."),feature("curving-shot","Искривлённый выстрел",7,"После промаха бонусным действием перенаправляет стрелу."),feature("ever-ready-shot","Всегда готовый выстрел",15,"При инициативе восстанавливает один выстрел, если запас пуст."),feature("arcane-shot-improvement","Усиление мистических выстрелов",18,"Урон выстрелов возрастает.")],
      "Кавалер":[feature("bonus-proficiency-cavalier","Дополнительное владение",3,"Получает навык или язык."),feature("born-saddle","Рождённый в седле",3,"Уверенно держится верхом и быстрее садится."),feature("unwavering-mark","Непоколебимая метка",3,"Помечает поражённую цель и защищает союзников."),feature("warding-maneuver","Защитный манёвр",7,"Реакцией добавляет к8 к КД союзника или себя."),feature("hold-line","Держать строй",10,"Провоцирует атаки при движении врага рядом и останавливает его."),feature("ferocious-charger","Свирепый натиск",15,"После разбега может сбить цель."),feature("vigilant-defender","Бдительный защитник",18,"Получает особую реакцию для провоцированных атак каждый ход.")],
      "Самурай":[feature("bonus-proficiency-samurai","Дополнительное владение",3,"Получает навык или язык."),feature("fighting-spirit","Боевой дух",3,"Бонусным действием получает преимущество и временные HP."),feature("elegant-courtier","Изысканный придворный",7,"Добавляет Мудрость к Убеждению и получает спасбросок Мудрости."),feature("tireless-spirit","Неутомимый дух",10,"При инициативе восстанавливает Боевой дух, если зарядов нет."),feature("rapid-strike","Стремительный удар",15,"Меняет преимущество одной атаки на дополнительную атаку."),feature("strength-before-death","Сила перед смертью",18,"Реакцией получает целый ход перед падением до 0 HP.")],
      "Воин-пси":[feature("psionic-power-fighter","Псионическая сила",3,"Кости псионической энергии защищают, двигают и усиливают удары."),feature("telekinetic-adept","Телекинетический адепт",7,"Получает полёт и усиленный толчок."),feature("guarded-mind","Защищённый разум",10,"Сопротивление психическому урону и снятие очарования/испуга."),feature("bulwark-force","Оплот силы",15,"Даёт группе половинное укрытие."),feature("telekinetic-master","Мастер телекинеза",18,"Накладывает телекинез и атакует бонусным действием.")],
      "Рунный рыцарь":[feature("bonus-proficiencies-rune","Дополнительные владения",3,"Кузнечные инструменты и язык великанов."),feature("rune-carver","Резчик рун",3,"Выбирает руны с постоянными и активными эффектами.",{choice:true}),feature("giants-might","Мощь великана",3,"Бонусным действием увеличивается и добавляет урон раз за ход.",{combatFormula:"1к6"}),feature("runic-shield","Рунический щит",7,"Реакцией заставляет врага перебросить атаку."),feature("great-stature","Великий рост",10,"Становится выше, а урон Мощи великана возрастает."),feature("master-runes","Мастер рун",15,"Каждую руну можно активировать дважды за отдых."),feature("runic-juggernaut","Рунический исполин",18,"Мощь великана становится ещё крупнее и сильнее.")]
    },
    monk:{
      "Путь пьяного мастера":[feature("bonus-proficiencies-drunken","Дополнительные владения",3,"Выступление и инструменты пивовара."),feature("drunken-technique","Пьяная техника",3,"После Шквала ударов получает Отход и дополнительное движение."),feature("tipsy-sway","Пьяное покачивание",6,"Быстро встаёт и перенаправляет промах врага."),feature("drunkards-luck","Удача пьяницы",11,"Тратит ци, чтобы отменить помеху."),feature("intoxicated-frenzy","Хмельное безумие",17,"Шквал ударов атакует больше разных целей.")],
      "Путь кенсея":[feature("path-kensei","Путь кенсея",3,"Выбирает оружие кенсея и получает защитные/дальнобойные приёмы.",{choice:true}),feature("one-brush","Единство с кистью",3,"Владение каллиграфией или живописью."),feature("magic-kensei-weapons","Магическое оружие кенсея",6,"Оружие кенсея считается магическим."),feature("deft-strike","Ловкий удар",6,"Тратит ци и добавляет кость боевых искусств к урону."),feature("sharpen-blade","Заточка клинка",11,"Тратит ци и временно даёт оружию бонус до +3."),feature("unerring-accuracy","Безошибочная точность",17,"Раз за ход перебрасывает промах оружием монаха.")],
      "Путь солнечной души":[feature("radiant-sun-bolt","Сияющий солнечный заряд",3,"Получает дальнобойную атаку излучением костью боевых искусств."),feature("searing-arc-strike","Пылающая дуга",6,"После Атаки может сотворить горящие ладони за ци."),feature("searing-sunburst","Пылающий солнечный взрыв",11,"Создаёт взрыв излучения на расстоянии."),feature("sun-shield","Солнечный щит",17,"Светится и реакцией наносит урон напавшему.")],
      "Путь милосердия":[feature("implements-mercy","Орудия милосердия",3,"Получает Проницательность, Медицину и набор травника."),feature("hand-healing","Рука исцеления",3,"Тратит ци и лечит костью боевых искусств + Мудрость.",{combatFormula:"martial+wis",rollKind:"healing"}),feature("hand-harm","Рука вреда",3,"После попадания тратит ци и добавляет некротический урон.",{combatFormula:"martial+wis"}),feature("physicians-touch","Прикосновение лекаря",6,"Рука лечения снимает состояния, а рука вреда отравляет."),feature("flurry-healing-harm","Шквал лечения и вреда",11,"Одна атака Шквала бесплатно превращается в лечение или вред."),feature("hand-ultimate-mercy","Рука высшего милосердия",17,"Возвращает недавно умершего к жизни за 5 ци.")],
      "Путь астрального «я»":[feature("arms-astral-self","Руки астрального «я»",3,"Тратит ци, создаёт дальние руки и атакует через Мудрость."),feature("visage-astral-self","Лик астрального «я»",6,"Улучшает зрение, голос и социальное давление."),feature("body-astral-self","Тело астрального «я»",11,"Получает отклонение энергии и дополнительную кость урона."),feature("awakened-astral-self","Пробуждённое астральное «я»",17,"Полная форма повышает КД и число атак.")]
    },
    paladin:{
      "Клятва покорения":[feature("channel-conquest","Божественный канал клятвы",3,"Покоряющее присутствие или направляемый удар.",{choice:true}),feature("aura-conquest","Аура покорения",7,"Испуганные враги рядом не двигаются и получают психический урон."),feature("scornful-rebuke","Презрительный отпор",15,"Атаковавший получает психический урон."),feature("invincible-conqueror","Непобедимый завоеватель",20,"На минуту получает сопротивление, дополнительную атаку и улучшенный крит.")],
      "Клятва искупления":[feature("channel-redemption","Божественный канал клятвы",3,"Усиливает убеждение или возвращает урон нападающему.",{choice:true}),feature("aura-guardian","Аура защитника",7,"Реакцией принимает урон союзника."),feature("protective-spirit","Защитный дух",15,"Автоматически лечится, когда ниже половины HP."),feature("emissary-redemption","Посланник искупления",20,"Сопротивляется урону и возвращает его существам, которых не атаковал.")],
      "Клятва славы":[feature("channel-glory","Божественный канал клятвы",3,"Атлетический герой или вдохновляющая кара.",{choice:true}),feature("aura-alacrity","Аура живости",7,"Повышает скорость союзников рядом."),feature("glorious-defense","Славная защита",15,"Реакцией повышает КД и может ответить атакой."),feature("living-legend","Живая легенда",20,"Получает преимущество Харизмы, переброс спасбросков и почти гарантированное попадание.")],
      "Клятва смотрителей":[feature("channel-watchers","Божественный канал клятвы",3,"Изгоняет планарных существ или укрепляет ментальные спасброски группы.",{choice:true}),feature("aura-sentinel","Аура стража",7,"Добавляет мастерство к инициативе союзников рядом."),feature("vigilant-rebuke","Бдительный отпор",15,"Реакцией наносит силовой урон после успешного ментального спасброска."),feature("mortal-bulwark","Смертный оплот",20,"Получает истинное зрение, преимущество против планарных существ и изгоняющие удары.")]
    },
    ranger:{
      "Сумрачный охотник":[feature("gloom-magic","Магия сумрака",3,"Получает тематические заклинания по уровням."),feature("dread-ambusher","Ужасный засадник",3,"В первый ход быстрее двигается и делает дополнительную усиленную атаку.",{combatFormula:"1к8"}),feature("umbral-sight","Мрачное зрение",3,"Получает тёмное зрение и невидим для существ, полагающихся на него."),feature("iron-mind","Железный разум",7,"Получает спасбросок Мудрости или другой ментальный спасбросок."),feature("stalkers-flurry","Шквал преследователя",11,"После промаха делает ещё одну атаку."),feature("shadowy-dodge","Теневое уклонение",15,"Реакцией даёт помеху атаке без преимущества.")],
      "Странник горизонта":[feature("horizon-magic","Магия горизонта",3,"Получает планарные заклинания по уровням."),feature("detect-portal","Обнаружение порталов",3,"Чувствует ближайший планарный портал."),feature("planar-warrior","Планарный воин",3,"Бонусным действием превращает урон следующей атаки в силовой и добавляет к8.",{combatFormula:"1к8"}),feature("ethereal-step","Эфирный шаг",7,"Бонусным действием ненадолго входит в Эфирный план."),feature("distant-strike","Дальний удар",11,"Телепортируется перед атаками и получает третью атаку по другой цели."),feature("spectral-defense","Призрачная защита",15,"Реакцией получает сопротивление урону атаки.")],
      "Убийца монстров":[feature("slayers-sense","Чутьё убийцы",3,"Изучает сопротивления, иммунитеты и уязвимости цели."),feature("slayers-prey","Добыча убийцы",3,"Помечает цель и раз за ход добавляет к6 урона.",{combatFormula:"1к6"}),feature("supernatural-defense","Сверхъестественная защита",7,"Добавляет к6 к спасброску или выходу из захвата добычи."),feature("magic-users-nemesis","Враг заклинателей",11,"Реакцией мешает телепортации или заклинанию."),feature("slayers-counter","Контратака убийцы",15,"При спасброске от добычи атакует её реакцией.")],
      "Странник фей":[feature("dreadful-strikes","Жуткие удары",3,"Раз за ход на каждой цели добавляет психический урон.",{combatFormula:"1к4"}),feature("fey-wanderer-magic","Магия странника фей",3,"Получает дополнительные заклинания и фейский дар."),feature("otherworldly-glamour","Потустороннее очарование",3,"Добавляет Мудрость к Харизме и получает социальный навык."),feature("beguiling-twist","Обманчивый поворот",7,"Реакцией перенаправляет проваленное очарование или испуг."),feature("fey-reinforcements","Фейское подкрепление",11,"Призывает фея без материального компонента и иногда без концентрации."),feature("misty-wanderer","Туманный странник",15,"Чаще телепортируется и может брать союзника.")],
      "Хранитель роя":[feature("gathered-swarm","Собранный рой",3,"Раз за ход рой наносит урон, двигает цель или двигает следопыта.",{combatFormula:"1к6"}),feature("swarmkeeper-magic","Магия хранителя роя",3,"Получает магическую руку и дополнительные заклинания."),feature("writhing-tide","Извивающийся поток",7,"Получает короткий полёт на рое."),feature("mighty-swarm","Могучий рой",11,"Усиливает все варианты роя."),feature("swarming-dispersal","Роевое рассеивание",15,"Реакцией получает сопротивление и телепортируется после урона.")]
    },
    rogue:{
      "Сыщик":[feature("ear-deceit","Слух к обману",3,"Низкие проверки Проницательности против лжи считаются 8."),feature("eye-detail","Глаз к деталям",3,"Бонусным действием ищет или расследует."),feature("insightful-fighting","Проницательный бой",3,"Побеждает Обман цели и получает Скрытую атаку без преимущества."),feature("steady-eye","Верный глаз",9,"Получает преимущество Восприятия и Расследования, если двигался не больше половины скорости."),feature("unerring-eye","Безошибочный глаз",13,"Ограниченно обнаруживает иллюзии и преобразования."),feature("eye-weakness","Глаз слабости",17,"Проницательный бой добавляет 3к6 к Скрытой атаке.",{combatFormula:"3к6"})],
      "Вдохновитель":[feature("master-intrigue","Мастер интриг",3,"Получает инструменты, языки и имитацию речи."),feature("master-tactics","Мастер тактики",3,"Помогает бонусным действием с 30 футов."),feature("insightful-manipulator","Проницательный манипулятор",9,"После разговора оценивает характеристики цели."),feature("misdirection","Перенаправление",13,"Заставляет соседнее существо принять атаку."),feature("soul-deceit","Душа обмана",17,"Мысли защищены, а магия считает правдивые слова истинными.")],
      "Разведчик":[feature("skirmisher","Застрельщик",3,"Реакцией отходит, когда враг завершает ход рядом."),feature("survivalist","Выживальщик",3,"Получает Природу и Выживание с компетентностью."),feature("superior-mobility","Превосходная мобильность",9,"Скорость возрастает на 10 футов."),feature("ambush-master","Мастер засад",13,"Преимущество инициативы и метка первой поражённой цели для группы."),feature("sudden-strike","Внезапный удар",17,"Бонусным действием делает дополнительную атаку с отдельной Скрытой атакой.")],
      "Головорез":[feature("fancy-footwork","Ловкая работа ног",3,"Атакованные существа не провоцируют атаки по плуту в этот ход."),feature("rakish-audacity","Дерзкая удаль",3,"Добавляет Харизму к инициативе и получает Скрытую атаку один на один."),feature("panache","Щегольство",9,"Провоцирует врага или очаровывает вне боя."),feature("elegant-maneuver","Элегантный манёвр",13,"Бонусным действием даёт преимущество Акробатике или Атлетике."),feature("master-duelist","Мастер дуэлянт",17,"Раз за отдых перебрасывает промах с преимуществом.")],
      "Фантом":[feature("whispers-dead","Шёпот мёртвых",3,"После отдыха получает временное владение навыком или инструментом."),feature("wails-grave","Плач из могилы",3,"После Скрытой атаки ранит вторую цель половиной костей.",{combatFormula:"sneak/2"}),feature("tokens-departed","Жетоны усопших",9,"Создаёт жетоны души, усиливающие спасброски и Плач."),feature("ghost-walk","Призрачная прогулка",13,"Становится призрачным и проходит сквозь существ/предметы."),feature("deaths-friend","Друг смерти",17,"Плач поражает первую цель, а жетон восстанавливается при отдыхе.")],
      "Клинок души":[feature("psionic-power-rogue","Псионическая сила",3,"Кости энергии помогают проверкам и телепатии."),feature("psychic-blades-soulknife","Психические клинки",3,"Создаёт клинок к6 и дополнительный клинок к4."),feature("soul-blades","Клинки души",9,"Кости улучшают попадание и телепортируют."),feature("psychic-veil","Психическая завеса",13,"Становится невидимым на час."),feature("rend-mind","Разрыв разума",17,"После Скрытой атаки оглушает цель психической энергией.")]
    },
    sorcerer:{
      "Божественная душа":[feature("divine-magic","Божественная магия",1,"Получает доступ к списку жреца и заклинание по склонности."),feature("favored-gods","Любимец богов",1,"После промаха или провала добавляет 2к4."),feature("empowered-healing","Усиленное лечение",6,"Тратит единицу чародейства и перебрасывает кости лечения."),feature("otherworldly-wings","Потусторонние крылья",14,"Бонусным действием получает полёт."),feature("unearthly-recovery","Неземное восстановление",18,"Раз за долгий отдых лечит половину максимума HP.")],
      "Теневая магия":[feature("eyes-dark","Глаза тьмы",1,"Получает тёмное зрение и позднее видит сквозь собственную тьму."),feature("strength-grave","Сила могилы",1,"Пытается остаться на 1 HP вместо падения."),feature("hound-ill-omen","Гончая дурного знамения",6,"Тратит чародейство и призывает гончую, мешающую спасброскам цели."),feature("shadow-walk","Хождение по теням",14,"Бонусным действием телепортируется между тенями."),feature("umbral-form","Теневая форма",18,"Тратит чародейство и становится бестелесной тенью.")],
      "Штормовое чародейство":[feature("wind-speaker","Говорящий с ветром",1,"Говорит на Первичном и его диалектах."),feature("tempestuous-magic","Бурная магия",1,"После заклинания летит 10 футов без провокаций."),feature("heart-storm","Сердце бури",6,"Сопротивляется молнии/грому и ранит рядом после стихийного заклинания."),feature("storm-guide","Вестник шторма",6,"Управляет ветром и дождём."),feature("storms-fury","Ярость шторма",14,"Реакцией ранит и отталкивает атакующего."),feature("wind-soul","Душа ветра",18,"Иммунитет к молнии/грому и постоянный полёт, которым можно делиться.")],
      "Аберрантный разум":[feature("psionic-spells-aberrant","Псионические заклинания",1,"Получает отдельный список заклинаний, которые можно заменять чарами/прорицанием."),feature("telepathic-speech","Телепатическая речь",1,"Создаёт телепатическую связь на минуты."),feature("psionic-sorcery","Псионическое чародейство",6,"Накладывает псионические заклинания за единицы чародейства без компонентов."),feature("psychic-defenses","Психическая защита",6,"Сопротивление психическому урону и преимущество против очарования/испуга."),feature("revelation-flesh","Откровение плоти",14,"Тратит чародейство на зрение, полёт, плавание или текучесть."),feature("warping-implosion","Искажающая имплозия",18,"Телепортируется и стягивает существ в оставленную область.")],
      "Заводная душа":[feature("clockwork-magic","Заводная магия",1,"Получает отдельный список заклинаний ограждения/преобразования."),feature("restore-balance","Восстановление равновесия",1,"Реакцией отменяет преимущество или помеху."),feature("bastion-law","Оплот закона",6,"Создаёт защитные к8 за единицы чародейства."),feature("trance-order","Транс порядка",14,"На минуту атаки не могут иметь преимущество, а проверки считаются минимум 10."),feature("clockwork-cavalcade","Заводная кавалькада",18,"Призывает духов порядка для лечения, ремонта и снятия заклинаний.")]
    },
    warlock:{
      "Небожитель":[feature("expanded-spells-celestial","Расширенный список заклинаний",1,"Добавляет светлые и лечебные заклинания."),feature("bonus-cantrips-celestial","Дополнительные заговоры",1,"Получает свет и священное пламя."),feature("healing-light","Исцеляющий свет",1,"Пул к6 лечит бонусным действием."),feature("radiant-soul","Сияющая душа",6,"Сопротивление излучению и бонус Харизмы к одному урону огнём/излучением."),feature("celestial-resilience","Небесная стойкость",10,"После отдыха выдаёт временные HP себе и группе."),feature("searing-vengeance","Пылающая месть",14,"При спасброске от смерти встаёт, лечится и ослепляет врагов.")],
      "Клинок-проклинатель":[feature("expanded-spells-hexblade","Расширенный список заклинаний",1,"Добавляет боевые и карающие заклинания."),feature("hexblades-curse","Проклятие клинка",1,"Бонусным действием усиливает урон, крит и лечение после смерти цели."),feature("hex-warrior","Воин проклятия",1,"Средние доспехи, щиты, воинское оружие и атаки Харизмой выбранным оружием."),feature("accursed-specter","Проклятый призрак",6,"Поднимает душу убитого гуманоида как союзника."),feature("armor-hexes","Доспех проклятий",10,"Проклятая цель промахивается по колдуну на 4+ к6."),feature("master-hexes","Мастер проклятий",14,"Переносит проклятие после смерти цели.")],
      "Бездонный":[feature("tentacle-deep","Щупальце глубин",1,"Бонусным действием создаёт щупальце, атакующее холодом."),feature("gift-sea","Дар моря",1,"Скорость плавания и подводное дыхание."),feature("oceanic-soul","Океаническая душа",6,"Сопротивление холоду и речь под водой."),feature("guardian-coil","Защитная спираль",6,"Щупальце реакцией уменьшает урон союзнику."),feature("grasping-tentacles","Хватающие щупальца",10,"Получает щупальца Эварда и не теряет на них концентрацию от урона."),feature("fathomless-plunge","Погружение в бездну",14,"Телепортирует группу к водоёму.")],
      "Гений":[feature("expanded-spells-genie","Расширенный список заклинаний",1,"Получает список по виду гения."),feature("genies-vessel","Сосуд гения",1,"Выбирает сосуд: убежище и дополнительный стихийный урон.",{choice:true,combatFormula:"proficiency"}),feature("elemental-gift","Стихийный дар",6,"Сопротивление стихии и временный полёт."),feature("sanctuary-vessel","Убежище сосуда",10,"Впускает группу в сосуд и ускоряет короткий отдых."),feature("limited-wish","Ограниченное желание",14,"Просит покровителя воспроизвести заклинание до 6 круга.")]
    },
    wizard:{
      "Военная магия":[feature("arcane-deflection","Магическое отражение",2,"Реакцией получает +2 КД или +4 к спасброску, ограничивая следующую магию."),feature("tactical-wit","Тактическая смекалка",2,"Добавляет Интеллект к инициативе."),feature("power-surge","Всплеск силы",6,"Копит энергию после контрзаклинания/рассеивания и добавляет урон."),feature("durable-magic","Прочная магия",10,"При концентрации получает +2 КД и спасброскам."),feature("deflecting-shroud","Отражающий покров",14,"Магическое отражение ранит несколько целей.")],
      "Певец клинка":[feature("training-war-song","Обучение войне и песне",2,"Лёгкие доспехи, одноручное оружие и Выступление."),feature("bladesong","Песнь клинка",2,"Бонусным действием повышает КД, скорость, Акробатику и концентрацию."),feature("extra-attack-bladesinger","Дополнительная атака",6,"Атакует дважды и одну атаку заменяет заговором."),feature("song-defense","Песнь защиты",10,"Тратит ячейку, чтобы уменьшить урон."),feature("song-victory","Песнь победы",14,"Добавляет Интеллект к урону оружием в Песни.")],
      "Орден писцов":[feature("wizardly-quill","Волшебное перо",2,"Создаёт перо и быстро переписывает заклинания."),feature("awakened-spellbook","Пробуждённая книга",2,"Книга служит фокусом, меняет тип урона и ускоряет ритуалы."),feature("manifest-mind","Проявленный разум",6,"Создаёт спектральный разум книги и колдует из его пространства."),feature("master-scrivener","Мастер-писец",10,"Создаёт свиток выбранного заклинания, усиленный на круг."),feature("one-word","Единство со словом",14,"Преимущество Тайны и жертва заклинаний книги для отмены урона.")]
    },
    artificer:{
      "Алхимик":[feature("tool-proficiency-alchemist","Владение инструментами",3,"Получает инструменты алхимика."),feature("alchemist-spells","Заклинания алхимика",3,"Всегда подготавливает тематические заклинания."),feature("experimental-elixir","Экспериментальный эликсир",3,"После отдыха создаёт случайные эликсиры; дополнительные — за ячейки."),feature("alchemical-savant","Алхимик-учёный",5,"Добавляет Интеллект к одному броску лечения/кислоты/огня/некротики/яда."),feature("restorative-reagents","Восстанавливающие реагенты",9,"Эликсиры дают временные HP и бесплатные малые восстановления."),feature("chemical-mastery","Химическое мастерство",15,"Сопротивление кислоте/яду и бесплатные высшие восстановления/исцеление.")],
      "Бронник":[feature("tools-trade-armorer","Инструменты ремесла",3,"Получает кузнечные инструменты."),feature("armorer-spells","Заклинания бронника",3,"Всегда подготавливает боевые заклинания."),feature("arcane-armor","Магический доспех",3,"Доспех становится фокусом, не требует Силы и заменяет конечности."),feature("armor-model","Модель доспеха",3,"Выбирает Защитника или Разведчика с собственным оружием.",{choice:true}),feature("extra-attack-armorer","Дополнительная атака",5,"Атакует дважды."),feature("armor-modifications","Модификации доспеха",9,"Части доспеха считаются отдельными предметами для инфузий."),feature("perfected-armor","Совершенный доспех",15,"Обе модели получают мощный тактический эффект.")],
      "Артиллерист":[feature("tool-proficiency-artillerist","Владение инструментами",3,"Получает инструменты резчика по дереву."),feature("artillerist-spells","Заклинания артиллериста",3,"Всегда подготавливает разрушительные заклинания."),feature("eldritch-cannon","Магическая пушка",3,"Создаёт Огнемёт, Силовую баллисту или Защитника.",{choice:true}),feature("arcane-firearm","Магическое огнестрельное оружие",5,"Фокус добавляет к8 к одному броску урона заклинания."),feature("explosive-cannon","Взрывная пушка",9,"Урон пушки возрастает, а её можно взорвать."),feature("fortified-position","Укреплённая позиция",15,"Две пушки одновременно и половинное укрытие рядом.")],
      "Боевой кузнец":[feature("tool-proficiency-smith","Владение инструментами",3,"Получает кузнечные инструменты."),feature("battle-smith-spells","Заклинания боевого кузнеца",3,"Всегда подготавливает защитные и боевые заклинания."),feature("battle-ready","Готовность к бою",3,"Владеет воинским оружием и атакует магическим оружием через Интеллект."),feature("steel-defender","Стальной защитник",3,"Получает конструкта-спутника с реакцией защиты."),feature("extra-attack-smith","Дополнительная атака",5,"Атакует дважды."),feature("arcane-jolt","Магический импульс",9,"Удар оружия/защитника лечит союзника или наносит силовой урон."),feature("improved-defender","Улучшенный защитник",15,"Импульс и отражение защитника усиливаются.")]
    }
  };
  xgte.subclassFeatures = {};
  tcoe.subclassFeatures = {};
  Object.entries(tracks).forEach(([classKey, subclasses]) => {
    Object.entries(subclasses).forEach(([subclassName, entries]) => {
      const targetPack = Object.values(xgte.subclasses || {}).flat().some(entry => entry.name === subclassName) ? xgte : tcoe;
      targetPack.subclassFeatures[classKey] ||= {};
      targetPack.subclassFeatures[classKey][subclassName] = entries;
    });
  });

  const subclassResources = {
    cleric:{
      "Домен могилы":level => level >= 1 ? [resource("Глаза могилы","wis","long")] : [],
      "Домен порядка":level => level >= 6 ? [resource("Воплощение закона","wis","long")] : [],
      "Домен мира":level => level >= 1 ? [resource("Укрепляющая связь","proficiency","long")] : [],
      "Сумеречный домен":level => level >= 1 ? [resource("Бдительное благословение",1,"none")] : []
    },
    druid:{
      "Круг снов":level => level >= 2 ? [resource("Кости Бальзама Летнего двора",level,"long",{die:6})] : [],
      "Круг пастыря":level => level >= 2 ? [resource("Тотем духа",1,"short")] : [],
      "Круг спор":level => level >= 6 ? [resource("Грибковое заражение","wis","long")] : [],
      "Круг звёзд":level => level >= 6 ? [resource("Космическое знамение","proficiency","long")] : [],
      "Круг лесного пожара":level => level >= 10 ? [resource("Прижигающее пламя","proficiency","long")] : []
    },
    fighter:{
      "Мистический лучник":level => level >= 3 ? [resource("Мистические выстрелы",2,"short")] : [],
      "Кавалер":level => level >= 7 ? [resource("Защитные манёвры","con","long")] : [],
      "Самурай":level => level >= 3 ? [resource("Боевой дух",3,"long")] : [],
      "Воин-пси":level => level >= 3 ? [resource("Кости псионической энергии","doubleProficiency","long",{dieByLevel:{3:6,5:8,11:10,17:12}})] : [],
      "Рунный рыцарь":level => level >= 3 ? [resource("Мощь великана","proficiency","long"),resource("Активации каждой руны",level >= 15 ? 2 : 1,"short")] : []
    },
    paladin:{},
    ranger:{
      "Странник фей":level => level >= 15 ? [resource("Туманный шаг без ячейки","wis","long")] : [],
      "Хранитель роя":level => level >= 7 ? [resource("Извивающийся поток","proficiency","long")] : []
    },
    rogue:{
      "Сыщик":level => level >= 13 ? [resource("Безошибочный глаз","wis","long")] : [],
      "Головорез":level => level >= 17 ? [resource("Мастер-дуэлянт",1,"short")] : [],
      "Фантом":level => level >= 3 ? [resource("Плач из могилы","proficiency","long")] : [],
      "Клинок души":level => level >= 3 ? [resource("Кости псионической энергии","doubleProficiency","long",{dieByLevel:{3:6,5:8,11:10,17:12}})] : []
    },
    sorcerer:{
      "Божественная душа":level => level >= 1 ? [resource("Любимец богов",1,"short")] : [],
      "Теневая магия":level => level >= 1 ? [resource("Сила могилы",1,"long")] : [],
      "Аберрантный разум":level => level >= 14 ? [resource("Откровение плоти","sorcery","none")] : [],
      "Заводная душа":level => level >= 1 ? [resource("Восстановление равновесия","proficiency","long")] : []
    },
    warlock:{
      "Небожитель":level => level >= 1 ? [resource("Кости Исцеляющего света",level + 1,"long",{die:6})] : [],
      "Клинок-проклинатель":level => level >= 1 ? [resource("Проклятие клинка",1,"short")] : [],
      "Бездонный":level => level >= 1 ? [resource("Щупальце глубин","proficiency","long")] : [],
      "Гений":level => level >= 1 ? [resource("Сосуд гения",1,"long")] : []
    },
    wizard:{
      "Военная магия":level => level >= 6 ? [resource("Всплески силы","int","long")] : [],
      "Певец клинка":level => level >= 2 ? [resource("Песнь клинка","proficiency","long")] : [],
      "Орден писцов":level => level >= 6 ? [resource("Проявление разума","proficiency","long")] : []
    },
    artificer:{
      "Алхимик":level => level >= 3 ? [resource("Экспериментальные эликсиры",level >= 15 ? 3 : level >= 6 ? 2 : 1,"long")] : [],
      "Бронник":level => level >= 3 ? [resource("Защитное поле","proficiency","long")] : [],
      "Артиллерист":level => level >= 3 ? [resource("Бесплатное создание пушки",1,"long")] : [],
      "Боевой кузнец":level => level >= 9 ? [resource("Магический импульс","int","long")] : []
    }
  };
  xgte.subclassResources = subclassResources;
  tcoe.subclassResources = subclassResources;

  const combatFeatures = {
    "Путь фанатика":[{ name:"Божественная ярость",formula:"1к6+classLevel/2",note:"Раз за ход во время ярости" }],
    "Коллегия шёпотов":[{ name:"Психические клинки",formula:"2к6",note:"Тратит Бардовское вдохновение; масштабируется по уровню" }],
    "Мистический лучник":[{ name:"Мистический выстрел",formula:"2к6",note:"Формула зависит от выбранного выстрела" }],
    "Кавалер":[{ name:"Непоколебимая метка",formula:"weapon+classLevel/2",note:"Особая бонусная атака по отмеченной цели" }],
    "Путь кенсея":[{ name:"Ловкий удар",formula:"martial",note:"1 ци после попадания" }],
    "Путь милосердия":[{ name:"Рука лечения",formula:"martial+wis",note:"Лечение за 1 ци",kind:"healing" },{ name:"Рука вреда",formula:"martial+wis",note:"Некротический урон за 1 ци" }],
    "Сумрачный охотник":[{ name:"Ужасный засадник",formula:"1к8",note:"Дополнительный урон первой дополнительной атаки" }],
    "Странник горизонта":[{ name:"Планарный воин",formula:"1к8",note:"Раз за ход; на 11 уровне 2к8" }],
    "Убийца монстров":[{ name:"Добыча убийцы",formula:"1к6",note:"Раз за ход по отмеченной цели" }],
    "Странник фей":[{ name:"Жуткие удары",formula:"1к4",note:"Раз за ход каждой цели; 1к6 с 11 уровня" }],
    "Хранитель роя":[{ name:"Собранный рой",formula:"1к6",note:"Урон либо перемещение; 1к8 с 11 уровня" }],
    "Фантом":[{ name:"Плач из могилы",formula:"sneak/2",note:"Урон второй цели" }],
    "Клинок души":[{ name:"Психический клинок",formula:"1к6+dex",note:"Первый клинок" },{ name:"Второй клинок",formula:"1к4+dex",note:"Бонусное действие" }],
    "Домен кузни":[{ name:"Божественный удар",formula:"1к8",note:"Огненный; 2к8 с 14 уровня" }],
    "Домен порядка":[{ name:"Божественный удар",formula:"1к8",note:"Психический; 2к8 с 14 уровня" }],
    "Сумеречный домен":[{ name:"Божественный удар",formula:"1к8",note:"Излучение; 2к8 с 14 уровня" }],
    "Рунный рыцарь":[{ name:"Мощь великана",formula:"1к6",note:"Раз за ход; растёт на 10 и 18 уровнях" }],
    "Воин-пси":[{ name:"Псионический удар",formula:"psi+int",note:"Тратит кость псионической энергии" }],
    "Артиллерист":[{ name:"Магическая пушка",formula:"2к8",note:"Огнемёт или силовая баллиста; 3к8 с 9 уровня" }],
    "Боевой кузнец":[{ name:"Магический импульс",formula:"2к6",note:"Лечение или силовой урон; 4к6 с 15 уровня" }]
  };
  xgte.combatFeatures = combatFeatures;
  tcoe.combatFeatures = combatFeatures;

  window.TT_CONTENT_PACKS = packs;
})();
