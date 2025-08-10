@iamtoxa/md-engine-core

Высокопроизводительное ядро многопользовательского игрового сервера на Bun + TypeScript: ECS, многопоточность (Workers), SharedArrayBuffer/Atomics, бинарный протокол. Проект открытый и расширяемый.


Статус: ранняя инициализация репозитория (этап 0: мета, туллинг, стандарты).


Лицензия: Apache-2.0
Основной язык документации: русский
Ветка по умолчанию: main

Цели


Низкая задержка и стабильные p99.
Простая и детерминированная архитектура: “одна зона = один воркер”.
Расширяемость: собственное ECS, протокол на FlatBuffers, модульные подсистемы.
Кроссплатформенность: Windows/macOS/Linux.

Требования


Bun >= 1.2.19
Git >= 2.40

Быстрый старт


Установите Bun: https://bun.sh
Установите зависимости: bun install
Установите git-хуки: bunx lefthook install
Запустите проверки:
Форматирование: bun run format:check
Линт: bun run lint
Типы: bun run typecheck
Тесты: bun test

Стандарты


SemVer + Keep a Changelog.
Conventional Commits (feat, fix, perf, refactor, docs, chore, test).
TS strict, отсутствие лишних аллокаций в горячих путях (с этапа реализации).
Biome для форматирования и линтинга.
Lefthook: pre-commit (format, lint, typecheck), pre-push (test).

Структура (план)


apps/ — приложения (server и т.д.)
packages/ — модули (ecs-core, net, runtime, utils, game-kit, data)
tools/ — генераторы/скрипты (например, протокол)
docs/ — документация (архитектура, ADR)
tests/, benchmarks/, load/ — тесты, бенчи, нагрузка

Документация


docs/ARCHITECTURE.md — обзор архитектуры (черновик).
CONTRIBUTING.md — как вносить вклад.
CODE_OF_CONDUCT.md — кодекс поведения.
SECURITY.md — как сообщать об уязвимостях.
CHANGELOG.md — изменения по версиям.

Лицензия
Apache-2.0 © 2025 iamtoxa