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
