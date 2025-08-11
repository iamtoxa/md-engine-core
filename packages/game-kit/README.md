packages/game-kit — базовый игровой набор над ECS


# Кратко


Назначение: готовый набор часто используемых компонентов и систем поверх ядра ECS, чтобы быстро собрать ходовую механику, ввод, здоровье, простую физику и AOI.
Что внутри: фабрика setupGameKit(world, options) с определениями компонентов и опциональных систем, утилиты AOI (решётка), вспомогательные функции.
Для кого: серверные миры (world workers) и, при желании, симуляция на клиенте для предсказания.

# Состав пакета


src/index.ts — экспорт setupGameKit и типов компонентов.
aoi/grid.ts — AOIGrid: простая и очень быстрая AOI-сетка для 3D координат.
(возможны дополнительные утилиты: события урона, базовые константы; смотрите индекс пакета вашей версии).

# Быстрый старт


Установите и подключите ECS-ядро:

import { World } from "@iamtoxa/md-engine-ecs-core"

Поднимите мир и установите game-kit:

import { setupGameKit } from "@iamtoxa/md-engine-game-kit"
const W = new World({ maxEntities: 100_000 })
const comps = setupGameKit(W, { enableDamage: true })

Создайте сущность игрока:

const e = W.createEntity()
W.addComponent(e as any, comps.Transform3D, { pos: [0,0,0], rot: [0,0,0,1], scale: [1,1,1] })
W.addComponent(e as any, comps.Velocity3D, { vel: [0,0,0] })
W.addComponent(e as any, comps.InputState, { move: [0,0,0], look: [1,0,0], buttons: 0, analog1: 0, analog2: 0, seq: 0 })
W.addComponent(e as any, comps.MoveSpeed, { speed: 5 })
W.addComponent(e as any, comps.PlayerControlled)
W.addComponent(e as any, comps.Health, { hp: 100, maxHp: 100 }) // если используется здоровье

В тиках вызывайте:

W.tick("input", 0)
W.tick("simulation", 1 / hz)
W.tick("post", 0)
W.tick("snapshot", 0)

# Компоненты (определяются при вызове setupGameKit)


Transform3D
pos: f32[3] — позиция (метры)
rot: f32[4] — кватернион (xyzw)
scale: f32[3] — масштаб (обычно [1,1,1])
Velocity3D
vel: f32[3] — мгновенная скорость (м/с)
InputState
move: f32[3] — желаемое направление движения (локально или мирово, на ваш выбор)
look: f32[3] — направление взгляда
buttons: u32[1] — битовая маска кнопок
analog1: f32[1], analog2: f32[1] — произвольные аналоговые оси/триггеры
seq: u32[1] — номер входа (для ack и сетевой синхронизации)
MoveSpeed
speed: f32[1] — скалярная скорость движения (м/с)
Health (опционально, включается всегда, а логика урона — флагом)
hp: u32[1]
maxHp: u32[1]
PlayerControlled (tag) — маркер управления игроком
Owner (опционально, если нужно)
owner: u32[1] — владелец/ид игрока; можно использовать при авторитете и снапшотах

# Системы (входят в состав по умолчанию)


ApplyInputToVelocity (стадия: simulation, приоритет: 50)
Читает InputState и MoveSpeed, пишет Velocity3D
Нормализует move до единичного вектора; vel = move * speed
Можно отключить и заменить своей системой, если нужна сложная кинематика
IntegrateVelocity (стадия: simulation, приоритет: 100)
Читает Transform3D и Velocity3D, пишет Transform3D.pos
pos += vel * dt
HealthDecay/HealthClamp (стадия: simulation, приоритет: 40/45) — если включено enableDamage в options:
Применяет урон/подлечивание из очереди событий или ресурсов
Гарантирует 0 <= hp <= maxHp

# Опции setupGameKit


enableDamage: boolean
true — регистрирует минимальную систему применения урона по событиям world.events "damage"
false — компонент Health будет доступен, но урон обрабатывайте сами
gravity: [number, number, number] | null
Если задано, добавляет к Velocity3D вектор гравитации каждый тик (простая модель)
movement: "simple" | "disabled"
"simple" — включает ApplyInputToVelocity и IntegrateVelocity
"disabled" — не добавляет базовые системы движения

# Пример интеграции с сетью


На входе world.worker из пакета net приходят ClientInput сообщения. Маппинг полей 1:1 к InputState.
После применения входа на стадии input/simulation данные используются системами game-kit.
При подготовке снапшота включайте в маску:
bit0 Transform3D
bit1 Velocity3D
bit2 Health
bit3 Owner (если используете)
Сброс changed-флагов делайте на стадии snapshot (W.tick("snapshot", 0)) после отправки.

# AOI: aoi/grid.ts


AOIGrid — решётка для быстрого поиска ближайших сущностей по радиусу.
Конструктор: new AOIGrid(cellSize: number)
Методы:
upsert(eid: number, x: number, y: number, z: number): void — вставить/обновить позицию сущности
remove(eid: number): void — удалить из решётки
queryCells(x: number, y: number, z: number, radius: number, out: number[]): void
Заполняет массив out идентификаторами сущностей, находящихся в окрестности радиуса
Фильтрация по точному расстоянию остаётся на вашей стороне
Рекомендации:
Обновляйте AOIGrid после интеграции Transform3D (в конце simulation стадии)
Используйте общий AOIGrid на мир и многократно переиспользуйте временный буфер out

# Пример использования AOI


const aoi = new AOIGrid(16)
// при тике
for (const eid of W.iterComponent(comps.Transform3D)) { const t = W.componentView(comps.Transform3D, eid)! const p = t.read("pos") aoi.upsert(eid, p[0], p[1], p[2]) }
// запрашиваем ближайшие к игроку
const out: number[] = []
aoi.queryCells(px, py, pz, 50, out)
// дальше вы фильтруете out по квадрату расстояний и строите снапшот

# События урона (если enableDamage)


Источник урона: world.events.emit("damage", { entityId, amount })
Система DamageApply на стадии simulation применяет изменения к Health
Можно заменить полностью своей системой; тогда при вызове setupGameKit передайте enableDamage: false

# Паттерны и расширение


Свои компоненты: определяйте через ecs-core и используйте вместе с базовыми из game-kit
Сложное движение: отключите movement простые системы и подключите свой набор с ускорениями, силами, коллизиями
Кастомное здоровье: оставьте Health как хранилище, но сами решайте, когда и как его менять
Снапшоты: маска изменений componentChanged в ecs-core отлично сочетается с базовыми компонентами game-kit

# Производительность


Компоненты определены как SoA с минимальным числом полей
Системы используют Query с предвычислением ссылок на поля
AOIGrid использует дискретную сетку и минимизирует проверяемые сущности при выдаче кандидатов
Избегайте аллокаций в горячем пути:
переиспользуйте временные массивы при чтении/записи полей
переиспользуйте массивы-выходы для AOIGrid.queryCells

# Единицы измерения и соглашения


Позиции — метры в правой декартовой системе координат
Время — секунды (dt), частоты — Гц
Скорость — м/с
Урон/здоровье — безразмерные целые (u32), шкалу задаёт игра

# Пример: минимальный мир с game-kit


import { World } from "@iamtoxa/md-engine-ecs-core"
import { setupGameKit } from "@iamtoxa/md-engine-game-kit"
import { AOIGrid } from "@iamtoxa/md-engine-game-kit/aoi/grid"
const W = new World({ maxEntities: 100_000 })
const comps = setupGameKit(W, { enableDamage: true })
const aoi = new AOIGrid(16)
function tick(dt: number) { W.tick("input", 0) W.tick("simulation", dt) // обновить AOI for (const eid of W.iterComponent(comps.Transform3D)) { const t = W.componentView(comps.Transform3D, eid)! const p = t.read("pos") aoi.upsert(eid, p[0], p[1], p[2]) } // snapshot W.tick("post", 0) W.tick("snapshot", 0) }

# Интеграция с runtime


В world worker серверного рантайма компоновка выглядит так:
const W = new ECSWorld({ maxEntities })
const comps = setupGameKit(W, { enableDamage: true })
const aoi = new AOIGrid(cellSize)
применяете вход (ClientInput → comps.InputState)
системы движения/урона от game-kit отрабатывают на стадии simulation
AOI и снапшоты собираются далее по вашему коду

# FAQ


Можно ли использовать только часть game-kit? Да. setupGameKit возвращает все компоненты; вы можете не регистрировать или отключить системную часть через опции.
Как добавить вертикальную гравитацию? Установите опцию gravity: [0, -9.81, 0] и убедитесь, что ваш мир допускает изменение vel каждый тик.
Можно ли использовать AOIGrid отдельно? Да. Импортируйте из "@iamtoxa/md-engine-game-kit/aoi/grid".

# Версионирование и совместимость


Минорные версии не ломают имена компонентов; breaking изменения отмечаются в CHANGELOG.
Совместимость с ecs-core по мажорным версиям: следите, чтобы обе библиотеки были одной мажорной версии в проекте.

# Вклад и развитие


Предложения по новым базовым компонентам и лёгким системам приветствуются.
Если нужна расширенная физика/коллизии — разумно вынести в отдельный модуль поверх ecs-core и интегрировать через ваш плагин.