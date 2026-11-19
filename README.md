# PROJECT GENESIS 1.3.1 — Interior Lighting

Interior rooms now have an electricity-aware Foundry v13 AmbientLight. The light is enabled only when the parent building receives power and the room switch is on. The switch is available to the GM or players owning a survivor token inside the room. Existing rooms are supported. See `README_RU.md` and `TESTING_1.3.1_RU.md` for details.

---

# PROJECT GENESIS 1.3.0

New in v1.3: GM-authoritative survivor token transit between linked exterior/interior scenes; a clickable interior exit, collision-aware landing positions, reserved doorway/buildable area, secure per-colony interior placement, electrical workstation diagnostics and order-to-station linkage for safe dismantling. All prior science, local warehouses and colony saves are retained. See `README_RU.md` and `TESTING_1.3_RU.md` for full Russian instructions. Test in a backup world before upgrading.

# PROJECT GENESIS 1.0.0

Standalone space-survival RPG system for **Foundry VTT v13**. Survive on an uninhabited alien planet, rebuild technology, manage crew logistics, research, facilities and utility grids, and complete a four-stage spaceship finale.

This is a **feature-complete build pending live Foundry acceptance**, not a claim that runtime bugs have been eliminated. Preserve your world: back up `Data/worlds` before updating. Existing actor and scene data are retained.

Russian install, roadmap and QA guides: [`README_RU.md`](README_RU.md), [`ROADMAP_1.0_RU.md`](ROADMAP_1.0_RU.md), [`TESTING_1.0_RU.md`](TESTING_1.0_RU.md).

Run offline tests with Node.js 22+: `node --test tests/*.test.mjs`.

---

# PROJECT GENESIS

Самостоятельная RPG-система для **Foundry VTT v13**, посвящённая научно-фантастическому выживанию и развитию колонии на необитаемой планете.

**Текущая версия исходного кода:** 0.8.1

## Установка по манифесту

После публикации первого релиза скопируйте ссылку:

`https://github.com/Danacra/project-genesis/releases/latest/download/system.json`

В Foundry: **Game Systems → Install System → Manifest URL**. 

> До появления GitHub Release ссылка выше не работает. Проверяйте выпуск на вкладке Releases.

## Автоматические выпуски

При первом добавлении исходников в `main` GitHub Actions запустит тесты и создаст релиз `v0.8.1`, приложив `system.json` и `project-genesis.zip`. При следующих версиях изменяйте `version` в `system.json` (например, на `0.8.2`) и отправляйте обновлённые файлы в `main`: новый релиз будет создан автоматически. Ссылка на `releases/latest/download/system.json` останется прежней.

**Важно:** исходный код пока тестировался только автоматическими тестами; требуется проверка в работающем Foundry v13. Перед обновлением мира сделайте резервную копию.

Подробности: [PUBLISHING_RU.md](PUBLISHING_RU.md), [README_RU.md](README_RU.md).
