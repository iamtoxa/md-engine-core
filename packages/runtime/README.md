packages/runtime — серверный рантайм (Supervisor + воркеры + шардирование + плагины)


# Кратко


Назначение: запуск игрового сервера как набора воркеров (gateway/world/job) под управлением Supervisor, с быстрым IPC (SharedArrayBuffer), зонированием мира и системой плагинов.
Что внутри:
Supervisor: оркестрация воркеров, маршрутизация клиентов, миграции между зонами, рестарты.
Gateway worker: WebSocket/REST, авторизация, rate-limit, метрики, проксирование трафика в миры, уведомления о смене зоны.
World worker: ECS-симуляция, AOI, снапшоты, принятие инпута, handoff при пересечении границ.
Job worker: произвольные фоновые задачи (под плагины).
ZoneManager: конфигурация зон (шардинг), границы, соседство.
Плагины: расширение логики игр (компоненты/системы), протокола (Command), REST/админ-роутов, задач.

# Архитектура


Один процесс = Supervisor + несколько воркеров (Web Worker-like):
Gateway N: принимает WS, проверяет JWT, держит пары SAB-очередей per client, форвардит бинарные сообщения в соответствующий World.
World M: исполняет логику ECS, формирует ServerSnapshot, отправляет в SAB выходной очереди.
Job K: вспомогательные работы (чат, матчмейкинг, кэш, обработка событий).
IPC: кольцевые очереди на SharedArrayBuffer (по одной паре toWorld/fromWorld на клиента).
Протокол: FlatBuffers Envelope (Ping/Pong, Hello, ServerInfo, ClientInput, Command, ServerSnapshot, Error).
Зоны: прямоугольные регионы, статически разбитые по X (по умолчанию). Перемещение клиента через границу зоны вызывает миграцию в соседний World.
Плагины: модули, загружаемые динамически в gateway/world/job. Расширяют компоненты ECS, системы, команды протокола (Command), REST-эндпойнты.

# Быстрый старт


Сгенерируйте код протокола: bun run gen:protocol
Соберите: bun run build
Запустите сервер: bun run apps/server/src/index.ts
По умолчанию поднимется один gateway и worldWorkers по числу CPU-1 с линейным разбиением по X (ширина 512).

# Структура пакета


src/supervisor/supervisor.ts — запуск/оркестрация воркеров, зоны, миграции, рестарты, heartbeats.
src/workers/gateway.ts — HTTP/WS, авторизация, WS-пайплайн, REST/админ, метрики, модули gateway.
src/workers/world.ts — ECS мир, AOI, обработка инпута/команд, снапшоты, handoff, модули world.
src/workers/job.ts — загрузка job-модулей, регистрация задач.
src/zone/zone_manager.ts — текущее статическое разбиение мира на зоны и поиск соседей.
src/types/control.ts — типы сообщений Supervisor ↔ воркеры (control plane).
src/config — схема, умолчания, загрузка, env MD_MODULES_CONFIG_FILE.
src/ext/types.ts — Plugin API (gateway/world/job контексты).
src/logger.ts, src/version.ts — логирование и версия.

# Конфигурация


Загружается через loadConfig (defaults + переопределения). Важные секции:
server: host, port, wsPath, restPrefix, metricsPath, adminPrefix, corsOrigins, trustProxy.
simulation: simulationHz, networkSnapshotHz.
aoi: radius, cellSize.
snapshot: keyframeIntervalSec, maxEntitiesPerSnapshot, maxBytesPerSnapshot.
workers: gatewayWorkers, worldWorkers, jobWorkers.
ipc: clientInputSabBytes, clientOutputSabBytes, controlSabBytes.
protocolLimits: maxWsFrameBytes, maxMessageBytes, inputRate{ ratePerSec, burst }, maxConnections.
auth.jwt: algorithm HS256, secret, accessTtl, refreshTtl.
worldLimits: softMaxEntitiesPerWorld, softMaxPlayersPerWorld, splitTrigger{ p99TickMs, consecutiveTicks }.
flags: path, hotReload.
modules: массив модулей (см. Плагины).

# Переменные окружения


MD_MODULES_CONFIG_FILE: путь к файлу конфигурации модулей (например, config/modules.json). Файл может быть либо массивом модулей, либо объектом { modules: [...] }. Пути entry внутри файла разрешаются относительно местоположения файла modules.json:
относительные пути → преобразуются к file:// URL с базой каталога файла;
абсолютные пути остаются абсолютными (перевод в file://);
bare specifier (npm-пакет) не изменяется.

# Плагины (модульность)


Описание модуля: { name, entry, target: "gateway" | "world" | "job" | "all", options: {} }.
Загрузка:
Supervisor пробрасывает cfg.modules во все воркеры.
Каждый воркер фильтрует модули по target и динамически импортирует entry (поддерживаются file:// URL и bare specifier).
Plugin API (см. src/ext/types.ts):
GatewayContext:
addRestRoute(path, handler), addAdminRoute(path, handler)
registerWsHandler(handler) — перехват входящих WS-кадров до форвардинга
metrics.counter(name).inc(), log.*, options
WorldContext:
world (ECS), addSystem(sys), registerMessage(type, handler) для Command
sendToClient(clientId, bytes)
timing{ hz, snapshotHz }, metrics, log, options
JobContext:
registerJob(name, handler), metrics, log, options
Расширение протокола:
Рекомендовано: универсальное сообщение Command (type:uint16, payload:[ubyte]).
На стороне World регистрируйте обработчики через registerMessage(type, handler).
Gateway может перехватывать любые входящие кадры и, при желании, отвечать прямо из gateway (например, эхо, ping) через registerWsHandler.

# Gateway worker


WS-пайплайн:
Проверка Origin (corsOrigins).
JWT в Authorization: Bearer или ?token=.
Пер-IP лимит соединений (limits.ipConnections).
Создание SAB-очередей per client (input/output), регистрация клиента в Supervisor.
ServerHello при открытии; Ping→Pong; остальное — в SAB toWorld.
Исходящие из мира читаются из SAB fromWorld и отправляются в ws.
REST:
Базовые маршруты: GET /api/v1/server/info, GET /api/v1/worlds, GET /metrics.
Админ-префикс /admin — расширяем плагинами.
Уведомление о смене зоны:
По сообщению Supervisor client_zone_change отправляет клиенту ServerInfo(world_id) без разрыва WS.
Метрики:
ws_* и rest_* базовые; плагиновые счетчики вида plugin_<name>.

# World worker


ECS:
Инициализация мира, установка компонентов/game-kit, планировщик систем по стадиям.
Обновление AOIGrid после интеграции трансформов.
Вход:
Читает из SAB входящие сообщения. ClientInput → в компоненты ввода; Command → handler плагина.
Снапшоты:
Периодичность networkSnapshotHz; инкрементальные дельты через componentChanged; ключевой кадр по keyframeIntervalSec.
Ограничение по entities и maxBytes.
Границы и миграции:
bounds приходят из Supervisor (по зоне).
При выходе за границу X формирует RequestMigrateMessage в Supervisor.
Supervisor делает handoff: detach у старого мира, attach_with_state в новый, обновляет маршрутизацию, шлюз шлёт ServerInfo(world_id).
Отправка:
writerEnqueue в SAB клиента (RingFlags.Droppable для снапшотов).

# Job worker


Загрузка модулей с target "job"/"all".
Регистрация задач (registerJob). В базовом ядре — каркас, вызов задач по требованию простым способом можно добавить через control или Redis.

# Supervisor


Ответственность:
Зоны/миры: инициализация ZoneManager и запуск world-воркеров с bounds соответствующей зоны.
Маршрутизация клиентов: client_open от gateway → client_attach в соответствующий world.
Миграции: request_migrate от world → local handoff → client_zone_change → Gateway.
Жизненный цикл воркеров: init, ready, heartbeat, restart с backoff.
Карта клиентов: clientId → { gatewayIndex, worldIndex, SABs }.
Heartbeat и рестарты:
Проверка lastHeartbeatAt; при таймауте — автоматический рестарт с экспоненциальным backoff.
Конфиг воркеров:
Gateway: серверная конфигурация + modules.
World: симуляция/снапшоты/AOI/bounds + modules.
Job: logs + modules.

# Контрольные сообщения (упрощённо)


init, ready, heartbeat, shutdown.
client_open/client_close (gateway → supervisor).
client_attach/client_detach, client_attach_with_state (supervisor → world).
request_migrate (world → supervisor).
client_zone_change (supervisor → gateway).

# Зоны и шардирование


ZoneManager (по умолчанию): линейное разбиение по X на worldWorkers зон фиксированной ширины (512).
Выбор зоны по позиции: gateway маршрутизирует по worldIndex, world проверяет пересечения с границами.
Смена зоны:
Детект world: позиция вышла за bounds → request_migrate.
Supervisor: detach в старом world; attach_with_state в новый; обновление clientMap; отправка client_zone_change на gateway.
Gateway: отправляет клиенту ServerInfo(world_id).
AOI на стыках зон:
Клиент остаётся подключён к одному gateway и получает снапшоты из привязанного world. Стратегия “двойной подписки” реализуется позже через межзонную шину.

# Мульти-узлы и Redis


Текущая реализация — один процесс/узел с SAB-IPC.
Для мульти-узлов:
Регистр зон в Redis (nodeId → зоны), маршрутизация по Redis pub/sub/NATS.
Межузловая миграция: либо Redirect клиента (сообщение/закрытие WS с причиной и переподключение), либо туннелирование на время handoff.
Плагины (чат/party) уже можно строить на Redis pub/sub как cross-zone сервисы.

# Безопасность и ограничения


Gateway:
JWT (HS256) с проверкой issuer.
CORS (origin allowlist).
Пер-IP лимит соединений.
Rate-limit входящих WS сообщений (token bucket).
Максимальные размеры кадров (maxWsFrameBytes/maxMessageBytes).
World: один поток исполнения. Внешняя синхронизация — через Supervisor/Redis (в будущей версии).
SAB-очереди: модель один писатель/один читатель. Не используйте одно кольцо из нескольких писателей/читателей.

# Логирование и метрики


Единый формат логов (json/pretty).
Метрики:
Gateway: ws_* и rest_*; дополнительно метрики плагинов.
World: можно расширять плагинами (счётчики), плюс heartbeat содержит tickCount.
/metrics возвращает текстовый вывод (Prometheus-подобный формат).

# Админ/REST


Базовые:
GET /api/v1/server/info — версия сервера/протокола, hz, миры, env.
GET /api/v1/worlds — список доступных миров (минимально).
GET /metrics — метрики.
Плагины gateway могут добавлять свои REST/админ-эндпойнты.

# Сетевой протокол


FlatBuffers схема находится в tools/protocol.
Используемое ядром:
ServerHello при открытии WS.
ClientInput с seq/движением и т. п.
ServerSnapshot — инкрементальные/ключевые кадры.
ServerInfo — уведомление о смене world_id при миграции.
Command — универсальный канал для плагинов (type:uint16, payload:bytes).
Кодеки и утилиты — в packages/net.

# Сценарии и паттерны


Простой запуск:
один gateway, несколько world; клиент подключается, получает ServerHello, шлёт ClientInput; world обрабатывает и рассылает снапшоты.
Миграция:
игрок пересёк x=512 → world-0 отправил request_migrate → Supervisor сделал handoff → Gateway уведомил ServerInfo(world_id=1).
Плагины:
world-плагин регистрирует компонент/систему и обработчик Command(100), при получении посылает ответ через sendToClient.
gateway-плагин добавляет REST /api/v1/mod/ping и перехватывает короткие WS кадры (эхо).

# Режим разработки


Конфигурация модулей:
создайте config/modules.json и укажите MD_MODULES_CONFIG_FILE=./config/modules.json
entry в этом файле разрешаются относительно его местоположения (./packages/example-mod/src/world_mod.ts и т. п.).
Изменили протокол — всегда запускайте bun run gen:protocol.
Перед запуском — bun run build.
Логи в dev приоритет debug/pretty.

# Распространённые ошибки


Не указали MD_MODULES_CONFIG_FILE и ожидаете загрузку модулей — cfg.modules будет пуст.
Неверный entry в modules.json — используйте относительные пути относительно файла и/или bare specifier пакета.
Переполнение SAB при входящих сообщениях — writerEnqueue вернёт false, gateway закроет соединение по backpressure_input.
Несовпадение версий протокола — смотрите ServerHello (protocol major/minor).

# Расширение и Roadmap


Динамический split/merge зон по метрикам (softMaxEntities, p99 tick, backlog).
Sticky-миграция у границ, cooldown для anti-thrashing (частично можно включить в world через локальный таймер).
Межузловая шина (Redis/NATS) для мульти-узлового шардирования и агрегированных снапшотов на границах.
Checkpoints состояния сущностей и восстановление после падения world.

# FAQ


Как добавить новый тип сетевого сообщения?
Рекомендуется через Command (type/payload) и обработчик в world-плагине; клиент понимает тот же тип.
Если нужно базовое сообщение — изменяйте FlatBuffers схему в tools/protocol, генерируйте код, обновляйте codec и версии.
Как добавить новую игровую механику?
Напишите world-плагин: определите компоненты через ecs-core, добавьте системы (addSystem), при необходимости обменивайтесь сообщениями через registerMessage/Command.
Можно ли добавить свои REST?
Да, в gateway-плагине через addRestRoute/addAdminRoute.

# Команды


Генерация протокола: bun run gen:protocol
Сборка: bun run build
Запуск: bun run apps/server/src/index.ts

# Поддержка


Вопросы по рантайму — issues/PR в репозитории.
Изменения в API плагинов и control-сообщениях сопровождаются заметками в CHANGELOG.