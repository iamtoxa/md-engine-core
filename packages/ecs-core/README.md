packages/ecs-core — ядро ECS


# Кратко


Назначение: высокопроизводительное ECS-ядро с SoA-хранилищем, безопасным публичным Query API и планировщиком систем по стадиям/приоритетам.
Основные фичи: SoA-компоненты, теговые компоненты, быстрые сигнатуры сущностей (битсеты), Query с view/read/write, changed-флаги, события, отложенное уничтожение, стадии тиков.
Фокус: нулевые/минимальные аллокации на горячем пути, простая и прозрачная типизация, удобство использования в геймплее и нетворкинге.

# Ключевые идеи


SoA (Structure of Arrays) для плотных компонентов: поля компонента лежат в отдельных типизированных массивах, максимально дружелюбно к CPU-кешу и векторизации.
Tag-компоненты для булевых признаков (отсутствие данных, только присутствие).
Быстрое определение состава сущности через сигнатуры (битовые маски); проверка наличия компонента — O(1).
Публичный Query API без доступа к приватным стореджам: итерация по сущностям и получение view на компоненты строго через методы World/Query.
Системы с декларацией чтений/записей (reads/writes), стадий и приоритетов — предсказуемое выполнение, удобно для планирования снапшотов и нетворкинга.

# Архитектура и терминология


Entity: логический объект. Имеет numeric id (0..maxEntities-1) и generation (для транспортного протокола).
Component:
SoA-компонент: именованные поля фиксированной формы (тип/размер). Примеры полей: f32[3], u32[1].
Tag-компонент: булев тег без данных (присутствует/нет).
Store: хранилище компонента (SoAStore или TagStore).
Signature: битовая маска компонентов у сущности. Используется для фильтрации в Query и быстрых проверок.
Query: выборка сущностей по набору условий. Доступ к view компонентов для чтения/записи.
System: единица логики. Имеет stage, priority, reads, writes и tick(world, dt).

# Базовый API


Создание мира
import { World, makeSystem } from "@iamtoxa/md-engine-ecs-core"


const world = new World({ maxEntities: 100_000 })


Определение компонентов
// SoA: имя, поля как { name, type, size }
const Transform3D = world.defineSoA("Transform3D", [
{ name: "pos", type: "f32", size: 3 },
{ name: "rot", type: "f32", size: 4 },
{ name: "scale", type: "f32", size: 3 }
] as const)


const Velocity3D = world.defineSoA("Velocity3D", [
{ name: "vel", type: "f32", size: 3 }
] as const)


// Tag
const PlayerControlled = world.defineTag("PlayerControlled")


Создание сущности и добавление компонентов
const e = world.createEntity()
world.addComponent(e, Transform3D, { pos: [0,0,0], rot: [0,0,0,1], scale: [1,1,1] })
world.addComponent(e, Velocity3D, { vel: [0,0,0] })
world.addComponent(e, PlayerControlled) // для тегов данные не нужны


Чтение/запись полей компонента
const tView = world.componentView(Transform3D, e.id)!
const pos = tView.read("pos") // Float32Array длиной 3 (или массив), зависит от реализации
tView.write("pos", [1,0,0])


# Важно:


componentView(Tag, id) вернёт пустой объект {} если тег есть и null если тега нет (см. ниже раздел Изменения API).
Для SoA используйте read/write только с допустимыми именами полей (редактор подскажет имена из as const у определения).

Запросы (Query API)
const q = world.query({ with: [Transform3D, Velocity3D] })


q.forEach((entityId) => {
const t = q.view(Transform3D, entityId)!
const v = q.view(Velocity3D, entityId)!
const p = t.read("pos")
const vel = v.read("vel")
p[0] += vel[0] * dt; p[1] += vel[1] * dt; p[2] += vel[2] * dt
t.write("pos", p)
})


// Итерирование идентификаторов
for (const eid of q.iterEntities()) {
// ...
}


// Быстрая проверка наличия
if (q.has(Transform3D, someEntityId)) {
// ...
}


Итерация по одному компоненту
for (const eid of world.iterComponent(Transform3D)) {
// eid гарантированно имеет этот компонент
}


Системы и планировщик
Определение систем
const movement = makeSystem({
name: "Movement3D",
stage: "simulation", // "input" | "simulation" | "post" | "snapshot"
priority: 100,       // ниже — раньше или наоборот? здесь: меньшее число выполняется раньше
reads: [Transform3D.id, Velocity3D.id],
writes: [Transform3D.id],
tick(world, dt) {
const q = world.query({ with: [Transform3D, Velocity3D] })
const pp = [0,0,0], pv = [0,0,0]
q.forEach((eid) => {
const t = q.view(Transform3D, eid)!; const v = q.view(Velocity3D, eid)!
t.read("pos", pp); v.read("vel", pv)
pp[0] += pv[0] * dt; pp[1] += pv[1] * dt; pp[2] += pv[2] * dt
t.write("pos", pp)
})
}
})


Регистрация и тики
world.addSystem(movement)
world.tick("input", 0)
world.tick("simulation", 1/30)
world.tick("post", 0)
world.tick("snapshot", 0) // удобно сбрасывать changed-флаги после отправки снапшотов


# Стадии выполнения (рекомендуемая семантика)


input: применение входа от клиентов/ИИ, чистые записи в компоненты ввода.
simulation: игровая логика, физика, перемещения.
post: отложенные операции (уничтожения, очистки), сбор метрик.
snapshot: финализировать кадр, сбросить changed-флаги для инкрементальных снапшотов.

События
Простой брокер событий на мир:
world.events.emit("damage", { entityId: e.id, amount: 10 })
const evts = world.events.drain("damage") // типизируйте через <T> при необходимости


# Отложенное уничтожение


destroyEntityDeferred(entity): помечает сущность к удалению, реальное удаление производится на стадии post.
Полезно для безопасной очистки при итерациях.

# Changed-флаги и инкрементальные снапшоты


Любая запись в компонент через view.write помечает соответствующую запись как изменённую (changed[idx] = 1).
Метод world.componentChanged(def, entityId) возвращает true, если компонент сущности менялся с момента последнего сброса.
Рекомендуется вызывать world.tick("snapshot", 0) после отправки снапшота — это сбросит changed-флаги (внутренне).

# Производительность


SoA и TypedArray: хранение полей в раздельных типизированных массивах минимизирует кэш-промахи.
Подумайте о переиспользовании временных массивов при read/write, чтобы избегать аллокаций на каждом eid.
Фильтрации по компонентам работают по сигнатурам (битмаски), что даёт быстрый отбор сущностей.
Tag-компоненты не содержат данных, их присутствие проверяется через сигнатуры/индексы.

# Актуальные изменения API (важно для миграции)


World.hasComponentById(def, entityId): boolean
Прямой O(1) способ проверить наличие компонента у сущности по компоненту-описанию.
Использует сигнатуру сущности: проверяет соответствующий бит.
Query.has(def, entityId) теперь делегирует в world.hasComponentById, что делает проверку быстрой и корректной для любых типов стореджей.
World.componentView(TagDef, entityId)
Для TagStore возвращает null, если у сущности нет тега; и возвращает пустой объект {} если тег присутствует (нет данных, только факт).
Для SoA — возвращает SoAView или null.
World.componentChanged(def, entityId): boolean
Возвращает true, если соответствующая запись компонента была изменена с последнего сброса changed-флагов.
Полезно для формирования дельта-снапшотов.

# Паттерны использования


Паттерн: применение инпута и движение
const ApplyInput = makeSystem({
name: "ApplyInput", stage: "simulation", priority: 50,
reads: [InputState.id, MoveSpeed.id], writes: [Velocity3D.id],
tick(w, dt) {
const q = w.query({ with: [InputState, MoveSpeed] })
const mv=[0,0,0], dir=[0,0,0]
q.forEach((eid) => {
const i = q.view(InputState, eid)!, s = q.view(MoveSpeed, eid)!, v = q.view(Velocity3D, eid)!
i.read("move", mv)
const speed = s.read("speed")[0] || 0
const len = Math.hypot(mv[0], mv[1], mv[2]) || 1
dir[0]=mv[0]/len; dir[1]=mv[1]/len; dir[2]=mv[2]/len
v.write("vel", [dir[0]*speed, dir[1]*speed, dir[2]*speed])
})
}
})


const Movement = makeSystem({
name: "Movement3D", stage: "simulation", priority: 100,
reads: [Transform3D.id, Velocity3D.id], writes: [Transform3D.id],
tick(w, dt) {
const q = w.query({ with: [Transform3D, Velocity3D] })
const p=[0,0,0], vel=[0,0,0]
q.forEach((eid) => {
const t=q.view(Transform3D,eid)!, v=q.view(Velocity3D,eid)!
t.read("pos", p); v.read("vel", vel)
p[0]+=vel[0]*dt; p[1]+=vel[1]*dt; p[2]+=vel[2]*dt
t.write("pos", p)
})
}
})


Паттерн: урон, уничтожение и очистка
const DamageApply = makeSystem({
name: "DamageApply", stage: "simulation", priority: 40,
reads: [Health.id], writes: [Health.id, Destroyed.id],
tick(w, dt) {
const evts = w.events.drain("damage") as Array<{ entityId:number; amount:number }>
if (evts.length === 0) return
const q = w.query({ with: [Health] })
const hp=[0], max=[0]
for (const {entityId, amount} of evts) {
if (!q.has(Health, entityId)) continue
const h = q.view(Health, entityId)!
h.read("hp", hp); h.read("maxHp", max)
const next = Math.max(0, Math.min(hp[0] - Math.max(0, amount), max[0] || hp[0]))
h.write("hp", [next])
if (next <= 0) w.addComponent({ id: entityId, gen: 0 } as any, Destroyed)
}
}
})


const CleanupDestroyed = makeSystem({
name: "CleanupDestroyed", stage: "post", priority: 1000,
reads: [Destroyed.id], writes: [],
tick(w, dt) {
const q = w.query({ with: [Destroyed] })
for (const eid of q.iterEntities()) w.destroyEntityDeferred({ id: eid, gen: 0 } as any)
}
})


# Тестирование


Модульные тесты удобно писать на уровне систем и Query API:
создайте World, зарегистрируйте компоненты/системы, накидайте сущности и вызовите world.tick для нужной стадии.
проверьте состояния через componentView.read.

# Ограничения и соглашения


Не потокобезопасно: World и его API предполагают использование из одного потока (воркера).
Добавляйте компоненты/удаляйте сущности вне критических итераций; для массовых удалений используйте destroyEntityDeferred + стадия post.
Не храните внешние ссылки на view и внутренние буферы дольше одного тика, если не уверены в их жизненном цикле. Получайте view по месту использования.
Имена компонентов должны быть уникальными в пределах мира.
Типы полей: f32/u32/i32 и т. п. — выбирайте исходя из семантики и бюджета памяти/сети.
Генерации сущностей (generation) в ядре используются для транспорта, но в большинстве систем достаточно numeric id.

# Расширение и интеграция


Новые компоненты: используйте defineSoA с as const в описании полей — это даёт автодополнение для read/write и раннюю проверку имён полей.
Новые теги: defineTag; используйте Query.has и World.hasComponentById для проверки.
Новые системы: описывайте reads/writes и стадию; используйте приоритеты для управления порядком (меньше — раньше).
Нетворкинг: используйте componentChanged и вызов world.tick("snapshot", 0) после рассылки снапшотов — это позволит отправлять дельты.

# Изменения в недавних версиях (важно)


Добавлен World.hasComponentById(def, entityId): O(1) проверка по сигнатуре; используется Query.has.
componentView(TagStore): возвращает null, если у сущности нет тега; {} если тег присутствует.
Query.has делегирует в World.hasComponentById для корректности и скорости.
Добавлен World.componentChanged(def, entityId): проверка changed-флага (используется при сборке дельт снапшотов).

# Типичные ошибки и их решения


Не тот порядок систем: используйте priority. Например, ApplyInput (50) должен быть раньше Movement (100).
Не сбрасываются changed-флаги: вызовите world.tick("snapshot", 0) после рассылки.
Нулевые view для тегов: проверьте наличие через Query.has или World.hasComponentById; componentView(Tag, id) вернёт null при отсутствии.
Падение read/write: убедитесь, что имя поля корректно (типовая подсказка приходит из as const определения).

# FAQ


Можно ли сделать AoS-компонент? Нет, ядро оптимизировано под SoA. Для редких/разреженных данных используйте отдельный SoA или ресурс/менеджер на стороне логики.
Как узнать список сущностей с конкретным набором компонентов? Query({ with: [...] }). Итерируйте iterEntities/forEach.
Есть ли поддержка ресурсов (singletons)? Храните их в своём модуле/системе, либо сделайте SoA с size:1 и назначьте одному eid.

# Версии и совместимость


Минорные обновления ядра не ломают публичный Query API; breaking-изменения будут подчёркнуты в CHANGELOG.
Используйте @iamtoxa/md-engine-ecs-core строго одной версии в рамках сервера и пакетов, чтобы избежать несовместимостей типов.
