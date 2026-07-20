const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = {};
require(path.join(process.cwd(), "public", "items-5e.js"));
require(path.join(process.cwd(), "public", "rules-5e.js"));
const itemSystem = require(path.join(process.cwd(), "public", "item-system.js"));
const rawItems = global.window.TT_ITEMS_2014;
const items = rawItems.map(itemSystem.enrichCatalogItem);

test("каталог 5e 2014 содержит обычное и магическое снаряжение", () => {
  assert.ok(Array.isArray(items));
  assert.ok(items.length >= 570, `В каталоге только ${items.length} позиций`);
  assert.equal(new Set(items.map(item => item.key)).size, items.length, "Ключи предметов должны быть уникальными");
  assert.ok(items.filter(item => item.catalogCategory === "weapon").length >= 37);
  assert.ok(items.filter(item => item.catalogCategory === "armor").length >= 13);
  assert.ok(items.filter(item => item.magical).length >= 300);
  assert.ok(items.filter(item => item.catalogCategory === "scroll").length >= 10);
});

test("боевые предметы содержат данные для автоматизации", () => {
  const longbow = items.find(item => item.key === "longbow");
  assert.equal(longbow.damage, "1d8");
  assert.equal(longbow.ability, "dex");
  assert.match(longbow.properties, /боеприпас/);

  const arrows = items.find(item => item.key === "arrow");
  assert.equal(arrows.quantity, 20);
  assert.equal(arrows.combatKind, "ammo");
  assert.equal(arrows.weight, 0.05);

  const greaterHealing = items.find(item => item.key === "magic-potion-of-healing-greater");
  assert.equal(greaterHealing.useFormula, "4к4+4");
  assert.equal(greaterHealing.combatKind, "consumable");

  const cloak = items.find(item => item.key === "magic-cloak-of-protection");
  assert.equal(cloak.slotHint, "cloak");
  assert.equal(cloak.magical, true);
});

test("каждый предмет пригоден для поиска и добавления в лист", () => {
  items.forEach(item => {
    assert.ok(item.key, "Нет ключа предмета");
    assert.ok(item.name, `Нет названия: ${item.key}`);
    assert.ok(item.catalogCategory, `Нет категории: ${item.key}`);
    assert.ok(Number(item.quantity) >= 1, `Некорректное количество: ${item.key}`);
    assert.ok(Number(item.weight) >= 0, `Некорректный вес: ${item.key}`);
  });
});

test("старые ключи предметов переводятся на единый каталог", () => {
  assert.equal(itemSystem.normalizeCatalogKey("arrows"), "arrow");
  assert.equal(itemSystem.normalizeCatalogKey("bolts"), "crossbow-bolt");
  assert.equal(itemSystem.normalizeCatalogKey("light-crossbow"), "crossbow-light");
  assert.equal(itemSystem.normalizeCatalogKey("plate"), "plate-armor");
  assert.equal(itemSystem.normalizeCatalogKey("potion-healing"), "magic-potion-of-healing-common");

  const migrated = itemSystem.canonicalizeInventoryItem({ catalogKey:"splint", name:"Наборный доспех" });
  assert.equal(migrated.catalogKey, "splint-armor");

  const catalogKeys = new Set(items.map(item => item.key));
  Object.values(global.window.TT_RULES.startingKits).flat().forEach(key => {
    const canonical = itemSystem.normalizeCatalogKey(key);
    assert.ok(catalogKeys.has(canonical), `Стартовый предмет ${key} не найден как ${canonical}`);
  });
  [...global.window.TT_RULES.weapons,...global.window.TT_RULES.armor,...global.window.TT_RULES.gear].forEach(item => {
    const canonical = itemSystem.normalizeCatalogKey(item.key);
    assert.ok(catalogKeys.has(canonical), `Старый предмет ${item.key} не найден как ${canonical}`);
  });
});

test("каталог полностью локализован и магические основы собираются механически", () => {
  assert.equal(items.filter(item => /[A-Za-z]{3}/.test(item.name)).length, 0);

  const magicWeapon = items.find(item => item.key === "magic-weapon-2");
  const longbow = items.find(item => item.key === "longbow");
  const weaponVariant = itemSystem.buildMagicVariant(magicWeapon,longbow);
  assert.equal(weaponVariant.name, "Длинный лук +2");
  assert.equal(weaponVariant.type, "weapon");
  assert.equal(weaponVariant.baseCatalogKey, "longbow");
  assert.equal(weaponVariant.magicBonus, 2);
  assert.equal(weaponVariant.damage, "1d8");
  assert.equal(weaponVariant.slotHint, "mainHand");

  const magicArmor = items.find(item => item.key === "magic-armor-1");
  const plate = items.find(item => item.key === "plate-armor");
  const armorVariant = itemSystem.buildMagicVariant(magicArmor,plate);
  assert.equal(armorVariant.name, "Латы +1");
  assert.equal(armorVariant.type, "armor");
  assert.equal(armorVariant.baseAc, 18);
  assert.equal(armorVariant.magicBonus, 1);
  assert.equal(armorVariant.strengthMinimum, 15);

  const flameTongue = items.find(item => item.key === "magic-flame-tongue");
  const flameVariant = itemSystem.buildMagicVariant(flameTongue,longbow);
  assert.deepEqual(flameVariant.extraDamage, { formula:"2d6", damageType:"огненный" });
});
