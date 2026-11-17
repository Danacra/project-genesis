# Публикация PROJECT GENESIS на GitHub

## 1. Создать репозиторий (один раз)

1. Войти в аккаунт `Danacra` на https://github.com/new.
2. Repository name: **project-genesis**; Visibility: **Public**.
3. **Не** включать «Add a README file», `.gitignore` или License на этом этапе.
4. Нажать **Create repository**.

## 2. Загрузить исходники

1. Распаковать `project-genesis-github-v0.8.1.zip`.
2. В новом пустом репозитории нажать **uploading an existing file** (или Add file → Upload files).
3. Перетащить **содержимое папки `project-genesis`**, а не сам ZIP. Убедиться, что в корне репозитория окажется `system.json`, а также `.github/workflows/publish.yml`, `scripts/package_release.py`, `genesis.mjs`, папки `module`, `assets`, `lang`, `styles`, `templates`, `tests`.
4. Commit directly to **main**.

Если браузер не поддерживает перетаскивание папок или скрытого каталога `.github`, загрузите через GitHub Desktop или Git CLI. Не публикуйте секреты и токены в репозитории.

## 3. Получить URL

На странице репозитория открыть вкладку **Actions** → **Publish PROJECT GENESIS (Foundry VTT)**. Проверить, что задача завершилась успешно. Если Actions при первом запуске отключены, включить их в настройках репозитория и нажать **Run workflow**.

После успешного релиза откройте вкладку **Releases**. В `v0.8.1` должны быть **два прикреплённых файла**: `system.json` и `project-genesis.zip`.

**Постоянный манифест (работает после публикации):**

https://github.com/Danacra/project-genesis/releases/latest/download/system.json

Эту ссылку нужно вставлять в Foundry v13: **Game Systems → Install System → Manifest URL**.

## 4. Будущие версии

- Обновить файлы системы.
- Изменить только `version` в `system.json` на следующий номер, например `0.8.2`.
- Отправить изменения в `main`.
- Workflow автоматически создаст новый релиз и заполнит `download` актуальным URL новой версии.
- Адрес манифеста **не изменится**.

**Не изменять идентификатор `id: project-genesis`, иначе старые миры могут потерять связь с системой.**

Если релиз не появился, открыть Actions и посмотреть ошибку тестов/сборки. Сам проект пока не проверен в рабочем Foundry v13.
