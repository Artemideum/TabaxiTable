const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

global.window = {};
require(path.join(process.cwd(), "public", "items-5e.js"));
const items = global.window.TT_ITEMS_2014;

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
