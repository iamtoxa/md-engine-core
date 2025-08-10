import { World } from "@iamtoxa/md-engine-ecs-core";
import { setupGameKit } from "@iamtoxa/md-engine-game-kit";

test("damage event reduces hp and destroys entity at zero", () => {
  const w = new World({ maxEntities: 100 });
  const { Health, Destroyed } = setupGameKit(w);

  const e = w.createEntity();
  w.addComponent(e, Health, { hp: 10, maxHp: 10 });

  // отправляем событие damage
  w.events.emit("damage", { entityId: e.id, amount: 15 });

  // обработка урона
  w.tick("simulation", 0);
  // пометка на уничтожение (есть тег Destroyed)
  expect(w.hasComponentById(Destroyed as any, e.id)).toBe(true);

  // удаление deferred на стадии post
  w.tick("post", 0);
  expect(w.aliveMask()[e.id]).toBe(0);
});
