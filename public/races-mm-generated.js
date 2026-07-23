/* Сгенерировано scripts/generate-mm-races.mjs.
   Это игровые шаблоны происхождения по разумным существам MM14, а не копии книжных текстов. */
(function(){
  const source={id:"mm14-races",short:"MM расы",name:"Происхождения Monster Manual 2014",officialName:"Monster Manual (2014) — monster lineage templates",year:2014};
  const races={
  "mm-aarakocra": {
    "name": "Ааракокра",
    "originalName": "Aarakocra",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "aarakocra"
    ],
    "size": "Средний",
    "speed": 25,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Ауран, Ааракокра",
    "skills": [],
    "traits": "Полёт без тяжёлого доспеха, природные когти и жизнь в высокогорье."
  },
  "mm-bugbear": {
    "name": "Багбир",
    "originalName": "Bugbear",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "bugbear"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гоблинский",
    "skills": [
      "stealth"
    ],
    "traits": "Длинные конечности, могучее телосложение, скрытность и внезапный удар. Жестокость Внезапная атака"
  },
  "mm-bullywug": {
    "name": "Булливаг",
    "originalName": "Bullywug",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "bullywug"
    ],
    "size": "Средний",
    "speed": 20,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Булливагский",
    "skills": [],
    "traits": "Амфибия, сильный прыжок и болотная маскировка."
  },
  "mm-centaur": {
    "name": "Кентавр",
    "originalName": "Centaur",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "centaur"
    ],
    "size": "Средний",
    "speed": 40,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Сильван",
    "skills": [],
    "traits": "Сложение скакуна, таран копытами и уверенное движение по открытой местности."
  },
  "mm-deep-gnome": {
    "name": "Глубинный гном",
    "originalName": "Deep Gnome Svirfneblin",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "deep-gnome-svirfneblin",
      "deep-gnome"
    ],
    "size": "Маленький",
    "speed": 25,
    "darkvision": 120,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гномий, Подземный",
    "skills": [
      "stealth"
    ],
    "traits": "Гномья хитрость, каменная маскировка и приспособленность к Подземью."
  },
  "mm-duergar": {
    "name": "Дуэргар",
    "originalName": "Duergar",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "duergar"
    ],
    "size": "Средний",
    "speed": 25,
    "darkvision": 120,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Дварфийский, Подземный",
    "skills": [],
    "traits": "Дуэргарская стойкость, врождённое увеличение и невидимость, чувствительность к солнцу."
  },
  "mm-githyanki": {
    "name": "Гитьянки",
    "originalName": "Githyanki Warrior",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "githyanki-warrior",
      "githyanki-knight",
      "githyanki"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гитский",
    "skills": [],
    "traits": "Псионика, воинская подготовка и астральные знания."
  },
  "mm-githzerai": {
    "name": "Гитцерай",
    "originalName": "Githzerai Monk",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "githzerai-monk",
      "githzerai-zerth",
      "githzerai"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гитский",
    "skills": [],
    "traits": "Псионика, ментальная дисциплина и монашеская выдержка."
  },
  "mm-gnoll": {
    "name": "Гнолл",
    "originalName": "Gnoll",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "gnoll"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Гноллий",
    "skills": [],
    "traits": "Укус, неутомимая погоня и свирепый натиск после падения врага."
  },
  "mm-goblin": {
    "name": "Гоблин",
    "originalName": "Goblin",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "goblin"
    ],
    "size": "Маленький",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гоблинский",
    "skills": [
      "stealth"
    ],
    "traits": "Проворный отход, ярость малого народа и привычка действовать из засады. Ловкий побег"
  },
  "mm-grimlock": {
    "name": "Гримлок",
    "originalName": "Grimlock",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "grimlock"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Подземный",
    "skills": [
      "perception",
      "stealth"
    ],
    "traits": "Слепое восприятие, обострённые слух и обоняние, каменная маскировка."
  },
  "mm-hobgoblin": {
    "name": "Хобгоблин",
    "originalName": "Hobgoblin",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "hobgoblin"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Гоблинский",
    "skills": [],
    "traits": "Воинская подготовка, дисциплина и боевое преимущество рядом с союзником."
  },
  "mm-kenku": {
    "name": "Кенку",
    "originalName": "Kenku",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "kenku"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Ауран",
    "skills": [
      "deception",
      "stealth"
    ],
    "traits": "Подражание звукам, искусная подделка и талант к засаде."
  },
  "mm-kobold": {
    "name": "Кобольд",
    "originalName": "Kobold",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "kobold"
    ],
    "size": "Маленький",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Драконий",
    "skills": [],
    "traits": "Тактика стаи, чувствительность к солнечному свету и умение отвлекать врага."
  },
  "mm-kuo-toa": {
    "name": "Куо-тоа",
    "originalName": "Kuo Toa",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "kuo-toa"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 120,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Подземный",
    "skills": [
      "perception"
    ],
    "traits": "Амфибия, скользкое тело и восприятие невидимых и эфирных существ."
  },
  "mm-lizardfolk": {
    "name": "Людоящер",
    "originalName": "Lizardfolk",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "lizardfolk"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Драконий",
    "skills": [
      "perception",
      "survival"
    ],
    "traits": "Укус, задержка дыхания, природная броня и ремесло из трофеев."
  },
  "mm-merfolk": {
    "name": "Мерфолк",
    "originalName": "Merfolk",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "merfolk"
    ],
    "size": "Средний",
    "speed": 10,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Акван",
    "skills": [],
    "traits": "Амфибия и высокая скорость плавания."
  },
  "mm-minotaur": {
    "name": "Минотавр",
    "originalName": "Minotaur",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "minotaur"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Бездны",
    "skills": [],
    "traits": "Рога, таран, безошибочная память лабиринтов и устрашающее сложение."
  },
  "mm-orc": {
    "name": "Орк",
    "originalName": "Orc",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "orc"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Орочий",
    "skills": [
      "intimidation"
    ],
    "traits": "Агрессивный рывок, могучее телосложение и выносливость в ближнем бою. Агрессивный"
  },
  "mm-sahuagin": {
    "name": "Сахуагин",
    "originalName": "Sahuagin",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "sahuagin"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 120,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Сахуагинский",
    "skills": [
      "perception"
    ],
    "traits": "Ограниченная амфибия, кровавая ярость и телепатическая связь с акулами."
  },
  "mm-satyr": {
    "name": "Сатир",
    "originalName": "Satyr",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "satyr"
    ],
    "size": "Средний",
    "speed": 35,
    "darkvision": 0,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Сильван",
    "skills": [
      "performance",
      "persuasion"
    ],
    "traits": "Бараньи рога, природная сопротивляемость магии и талант музыканта."
  },
  "mm-troglodyte": {
    "name": "Троглодит",
    "originalName": "Troglodyte",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "troglodyte"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Троглодитский",
    "skills": [
      "stealth"
    ],
    "traits": "Хамелеонья кожа, резкий запах, когти и жизнь в глубинах."
  },
  "mm-yuan-ti-pureblood": {
    "name": "Юань-ти чистокровный",
    "originalName": "Yuan Ti Pureblood",
    "source": "mm14-races",
    "tags": [
      "monster-lineage",
      "mm14",
      "yuan-ti-pureblood"
    ],
    "size": "Средний",
    "speed": 30,
    "darkvision": 60,
    "bonuses": {},
    "flexible": [
      2,
      1
    ],
    "languages": "Общий, Бездны, Драконий",
    "skills": [],
    "traits": "Сопротивление магии, защита от яда и врождённая змеиная магия."
  }
};
  window.TT_CONTENT_SOURCES={...(window.TT_CONTENT_SOURCES||{}),[source.id]:source};
  window.TT_CONTENT_PACKS={...(window.TT_CONTENT_PACKS||{}),mm14races:{id:"mm14races",source,races}};
})();
