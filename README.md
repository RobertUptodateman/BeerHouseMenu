# BeerHouseMenu

Технический каркас статичного меню бара: одностраничный сайт на GitHub Pages и веб-админка Decap CMS для правки данных.

## Цель

Минимальный рабочий прототип. На первом этапе — одна карточка пива. Это каркас: сначала должна стабильно работать цепочка «вход в админку → изменение данных → коммит в репозиторий → обновление на сайте». Дизайн и список позиций перерабатываются после этого.

Репозиторий: [RobertUptodateman/BeerHouseMenu](https://github.com/RobertUptodateman/BeerHouseMenu.git).

## Технические требования

### Публичная часть

- Один HTML-файл: `index.html`.
- Данные из `data/menu.json`.
- При загрузке и далее каждые 30–60 секунд — `fetch` JSON.
- На странице — одна карточка пива по полученным данным.
- После смены JSON карточка обновляется без ручной перезагрузки страницы.
- Если JSON временно недоступен, страница не ломается: остаются последние успешные данные и короткое сообщение об ошибке.

### Админ-часть

- Путь: `/admin/`.
- Decap CMS.
- Редактирование одного JSON-файла с одной позицией пива.
- Сохранение создаёт коммит в репозиторий.

### Инфраструктура

- Хостинг: GitHub Pages (полностью статический сайт).
- Вход в админку: GitHub OAuth.
- OAuth-прокси: Cloudflare Worker.
- Один общий GitHub-аккаунт для доступа в админку.
- Секреты (`Client ID`, `Client Secret`) хранятся только в Worker.

## Поток данных

1. Пользователь открывает `/admin/`.
2. Decap CMS инициирует вход через Cloudflare Worker.
3. Worker проводит OAuth с GitHub и возвращает `access_token`.
4. Токен сохраняется в `localStorage` браузера.
5. Пользователь правит позицию пива в Decap CMS.
6. При сохранении Decap CMS коммитит обновлённый JSON в репозиторий.
7. GitHub Pages начинает отдавать новый JSON (обычно десятки секунд–пара минут из‑за CDN).
8. Публичная страница при следующем опросе получает данные и обновляет карточку.

```
Браузер /admin/
  → Decap → Worker /auth
  → GitHub OAuth
  → Worker /callback → access_token → localStorage
  → Save → GitHub Contents API (commit JSON)
  → Pages отдаёт новый JSON
  → index.html poll 30–60 с → карточка
```

## Структура данных

`data/menu.json` — один объект (не массив):

```json
{
  "name": "Название",
  "style": "IPA",
  "abv": 5.5,
  "ibu": 40,
  "volume": "0.5 л",
  "price": 450,
  "available": true
}
```

| Поле | Смысл |
|---|---|
| `name` | название |
| `style` | стиль |
| `abv` | крепость |
| `ibu` | горечь (IBU) |
| `volume` | объём |
| `price` | цена |
| `available` | наличие (`true` / `false`) |

## Структура репозитория

Минимум файлов, без сборки фронтенда:

```
/
  index.html           # публичное меню
  data/menu.json       # одна позиция пива
  admin/index.html     # оболочка Decap CMS
  admin/config.yml     # бэкенд GitHub + поля
  README.md
```

Worker OAuth **не публиковать** как часть Pages. Предпочтительный вариант — отдельный репозиторий (секреты и деплой изолированы). Альтернатива — папка `oauth-worker/` и публикация Pages только из корня сайта через Actions; для каркаса это лишняя сложность.

## Локальный запуск

1. Отдать корень проекта любым статическим сервером, например `npx serve -l 8765` (открыть `http://localhost:8765/`).
2. Для админки в соседнем терминале запустить `npx decap-server` (порт 8081) и открыть `http://localhost:8765/admin/`.

С `local_backend: true` Decap на localhost пишет изменения прямо в `data/menu.json` без коммита. На GitHub Pages эта настройка игнорируется, там используется бэкенд `github`.

## План реализации

### 1. Данные и публичная страница

- Завести `data/menu.json` и `index.html`.
- Опрос: каждые ~45 с, `fetch('data/menu.json?t=' + Date.now(), { cache: 'no-store' })`.
- Относительный путь к JSON, чтобы сайт работал и в корне Pages, и по subpath `/BeerHouseMenu/`.
- При ошибке fetch — не сбрасывать карточку.
- При `available: false` — состояние «нет в наличии».
- Без фреймворков: HTML + CSS + небольшой JS.

### 2. Decap CMS

- `admin/index.html` — оболочка CMS с CDN (без npm).
- `admin/config.yml`:
  - `backend.name: github`;
  - `repo: RobertUptodateman/BeerHouseMenu`;
  - `branch: master`;
  - `base_url` — URL Cloudflare Worker (без завершающего `/`);
  - коллекция типа `files`, один файл `data/menu.json`;
  - поля 1:1 со структурой JSON (`string` / `number` / `boolean`).
- Сначала можно проверить форму с `local_backend: true` и `npx decap-server`.
- Для критерия «вход через GitHub» локальный бэкенд выключается, подключаются Worker и OAuth App.

### 3. GitHub OAuth и Cloudflare Worker

1. GitHub → **OAuth App** (не GitHub App):
   - Homepage URL — URL GitHub Pages;
   - Authorization callback URL — `https://<worker>.workers.dev/callback`.
2. Worker:
   - `GET /auth` — редирект на GitHub;
   - `GET /callback` — обмен `code` на `access_token`, передача токена в окно CMS;
   - CORS для origin сайта на Pages.
3. Секреты Worker: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, при необходимости разрешённый origin сайта.

Доступ в админку = GitHub-аккаунт, который может войти через это OAuth App и имеет push в репозиторий.

### 4. GitHub Pages

- Источник: ветка `master`, папка `/` (root).
- Если репозиторий не `username.github.io`, сайт будет по адресу `https://<user>.github.io/BeerHouseMenu/` — это нужно учесть в Homepage OAuth App.

### 5. Склейка и проверка

Порядок коммитов при реализации:

1. `data/menu.json` + `index.html` (карточка, опрос, ошибка fetch).
2. `admin/` + `config.yml` (сначала локальный бэкенд).
3. Worker + OAuth App + `base_url` в конфиге CMS.
4. GitHub Pages и полный цикл.

## Риски

- **Кэш Pages.** Без `?t=` и `cache: 'no-store'` карточка может показывать старый JSON.
- **Subpath репозитория.** Неверный базовый URL ломает `/admin/` и `fetch`.
- **Формат JSON.** Decap `files` пишет объект верхнего уровня; публичный JS не должен ждать массив.
- **Права токена.** У OAuth App должен быть доступ к репозиторию.
- **CORS / origin Worker.** Если origin не совпадает с URL Pages, токен не вернётся в CMS.
- **Задержка CDN.** После Save обновление на сайте не мгновенное; опрос 30–60 с это компенсирует.

Много карточек лучше вводить после зелёных критериев первого этапа: JSON расширяется до `{ "beers": [ ... ] }`, коллекция Decap меняется на список, OAuth и Pages остаются теми же.

## Требования к реализации

- Максимально простая структура репозитория.
- Минимум зависимостей.
- Decap CMS работает с одним JSON-файлом.
- Публичная страница устойчива к недоступному JSON.
- Цепочка «вход → редактирование → коммит → обновление сайта» работает стабильно.

## Критерии готовности первого этапа

- Можно войти в `/admin/` через GitHub.
- Можно изменить данные одной позиции пива и сохранить.
- Изменения появляются в JSON-файле в репозитории.
- Публичная страница сама подхватывает обновлённые данные и отображает их.
