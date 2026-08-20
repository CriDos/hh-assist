# HH Assessment: протокол тестов и защита — актуальный справочник

Дата обновления: 2026-08-13. Из документа удалены историческая хроника userscript, разделы про старую сборку 2.53.93 и неподтверждённые гипотезы. Остаётся только подтверждённое живыми экспериментами (сессии 2026-07-13, 2026-08-10, 2026-08-11 на тестовом аккаунте; 2026-08-11 — code-практика PHP, 4/4 задачи, SUCCESS) и анализом текущих frontend-бандлов. 2026-08-13: расширение переведено на синтетический fingerprint (см. §3.1 «Синтетический fingerprint») — живой сбор на странице раздела больше не используется.

Полный каталог разделов: `docs/hh-catalog-2026-08-11.json`.

## 1. Каталог тестов (список разделов)

- URL: `GET https://spb.hh.ru/applicant/skill_verifications/methods` — SSR, API-запросов нет.
- Данные: `<template class="SkillsFront-InitialState">`, ключ `skillsVerificationMethodsPage.items` — 22 раздела. **Внимание (2026-08-11): на странице каталога у SSR-шаблона класс ОТСУТСТВУЕТ** (пустой `class=""`, содержимое ~200 KB); на странице раздела класс `SkillsFront-InitialState`. После SPA-гидрации содержимое шаблона пропадает — читать надо `template.content.textContent` сразу после загрузки. JSON двойно заэкранирован: `&#34;` → `"`, `\\` → `\` (снимается двумя replace + JSON.parse).
- Структура раздела:
  - `id` (Python=1114, Java=3093, SQL=1252, C#=230, …), `name`, `category` (`SKILL` | `LANG`), `source` (партнёры: Git/SQL — Skypro, Английский — Skyeng);
  - `result` — итог: `level {id,name}`, `state` (`EFFECTIVE` | `NONE`), `theory`/`practice` (`SUCCESS` | `FAILURE` | `AVAILABLE` | `NOT_EXIST`), `availableAt` (когда можно пересдать), `validUntil` (срок подтверждения, ~1 год);
  - `levels[]` — уровни: `id` (8/9/10 = base/middle/advanced; у Английского a1..c2), `internalId`, `name`, `rank` (1/2/3); каждый уровень: `theory`/`practice` — `{id, name, taskNumber, estimatedTime (сек), availability {availableAt, status: AVAILABLE | TEMPORARY_UNAVAILABLE}, validity {state, validUntil}, externalId, trainingExternalId}`.
- Подтверждено: проваленная практика → `availability.status = TEMPORARY_UNAVAILABLE` с `availableAt` через 1 месяц (Golang/PHP/Python base practice: 2026-09-10/11) — серверная блокировка **per-level**, UI показывает «Попробовать снова можно <дата>». Другие уровни того же раздела остаются доступны.

## 2. Страница раздела (выбор уровня/вида)

- URL: `GET https://spb.hh.ru/applicant/skills/<skillId>/verification_methods?rank=<1|2|3>&kind=<theory|practice>` (пример: `?rank=1&kind=theory`).
- SSR; данные в `<template class="SkillsFront-InitialState">`, ключ `applicantKeyskillVerificationMethodsPage`: `{method: <тот же item из каталога>, rank, kind, isEpguCertMethod, showAntifraudModal, reportLink}`.
- Табы «Базовый/Средний/Продвинутый» и radio «Теория/Практика» — SPA через `history.pushState`, без запросов (весь метод уже в SSR). Заблокированный вид — radio disabled с датой.
- «Начать тест» открывает модалку с предупреждениями; кнопка старта — `[data-qa="modal-start-btn"]` внутри `[role=dialog]`.

## 3. Старт теста

Цепочка (подтверждена дважды: JS Advanced и Python theory):

```
POST spb.hh.ru/api/fl?u=...&cfidsgib-w-hh=...        (GIB fingerprint, 3–5 раз, тела 12–13 KB зашифрованы)
GET  spb.hh.ru/skills/applicant/keyskills/verification_methods/redirect_to_test
     ?strict_hash=...&soft_hash=...&hardware_hash=...&xhh=...&fingerprintjs=...
     &skill_id=<skillId>&kind=theory&id=<theory.id>&origin=https%3A%2F%2Fspb.hh.ru
     &skill_category=skills&last_id=...&hhtmFrom=skill_assessment_current
     → 302
GET  assessment.hh.ru/tests/<skillId>?contestToken=<uuid>   → 302 (токен в cookie contest_token)
GET  assessment.hh.ru/tests/<skillId>                       → 200 HTML
```

- `id` в redirect — это `theory.id`/`practice.id` из каталога (Python base theory id=294).
- `contestToken` — новый UUID на каждую попытку; сохраняется в cookie `contest_token` на assessment.hh.ru; старый токен не работает для повторного запуска.
- `redirect_to_test` **без** fingerprint-параметров → `404 {}`.
- Fingerprint-хэши (`strict_hash`, `soft_hash`, `hardware_hash`, `xhh`, `fingerprintjs`, `last_id`) **стабильны между попытками** (сравнение JS Advanced → JS Basic: идентичны) — вычисляются из характеристик устройства.
- `window.gib` (GIB = Guarded Identity Bridge): `gib.getCFIDS()`, `gib.getOTTHeaders()`, `gib.gibHash()`, `gib.gibHash_sha256()`, `gib.flash()` (сбор/отправка fingerprint), `gib.IS_AUTHORIZED`. Cookies: `cfidsgib-w-hh`, `gsscgib-w-hh`, `fgsscgib-w-hh`, `__zzatgib-w-hh`. GIB работает на spb.hh.ru, не на assessment.
- Первый вопрос теста вшит в SSR HTML: `<template class="AssessmentFront-InitialState">`, ключ `pageCertTests`: `{currentTask {taskId, description, answers[{answer, uuid}], subType, media}, contestName, taskNumber, taskCount, timeLeftSeconds, hhuid, finishModalType}`.

## 3.1 Полная расшифровка fingerprint (подтверждено 2026-08-11, 5/5 параметров совпали с реальным redirect)

Все параметры `redirect_to_test` генерируются клиентски и воспроизводятся формулой. Проверка: вычисленные значения идентичны захваченным в реальном redirect (Python theory).

### Источники (где живёт код)

| Что | Где |
|---|---|
| `window.gib` (GIB SDK) | чанк `https://i.hh.ru/shared/413.<hash>.js`, модуль `825` (обфусцирован, но суть ясна: `Di`-словарь содержит `canvas`, `fpEncrypt`, `setCFIDS`, `rsaModulus`, `__zzat` и т.д.) |
| FingerprintJS v4.6.2 | модуль `84530` в `skills.hh.ru/static/notSharedVendors.<hash>.js` (экспорт `ZP`: `load()`, `hashComponents()`, `componentsToDebugString()`); Babel-хелперы — модуль `28395` в чанке `9232` |
| `xhh` | security-remote `https://i.hh.ru/shared/__federation_expose_security.<hash>.js` → промис `fingerprintPromise` (модуль `281` в чанке `823`) |
| `securePortalFingerprintPromise` | тот же модуль `281`; резолвится в строку (пример `288ee6a8e1f92ad48142dbf80e6e6e62d055796d`) |
| Формула хэшей | `skills.hh.ru/static/ApplicantKeyskillsVerificationMethods-route.<hash>.js`: функции `Z` (SHA-256), `J` (конкатенация компонентов), `W` (сборка `strict/soft/hardware_hash` + `xhh` + `fingerprintjs`) |

### Формула (дословно из route-чанка)

```js
// Z: SHA-256 hex
async function Z(e) {
  const t = new TextEncoder;
  const i = await crypto.subtle.digest('SHA-256', t.encode(e));
  return [...new Uint8Array(i)].map(e => e.toString(16).padStart(2, '0')).join('');
}

// J: компонент по точечному пути → строка; массивы сортируются и сериализуются
function J(e, paths) {
  return paths.map(p => {
    const v = p.split('.').reduce((acc, seg) => acc?.[seg], e);
    return Array.isArray(v) ? JSON.stringify([...v].sort())
      : (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v ?? ''));
  }).join('|');
}

// W: итоговый объект fingerprint
async function W(fpPromise) {
  const [t, xhh] = await Promise.all([H.then(e => e.get()), fpPromise]); // H = FingerprintJS ZP.load()
  return {
    strict_hash: await Z(J(t.components, [
      'canvas.value.geometry','canvas.value.text',
      'webGlBasics.value.rendererUnmasked','webGlBasics.value.vendorUnmasked',
      'webGlExtensions.value.extensions','plugins.value','fonts.value',
      'screenResolution.value','colorDepth.value','deviceMemory.value',
      'hardwareConcurrency.value','math.value','audio.value'])),
    soft_hash: await Z(J(t.components, [
      'canvas.value.geometry','webGlBasics.value.rendererUnmasked',
      'webGlBasics.value.vendorUnmasked','webGlExtensions.value.extensions',
      'fontPreferences.value','screenResolution.value','colorDepth.value',
      'deviceMemory.value','hardwareConcurrency.value'])),
    hardware_hash: await Z(J(t.components, [
      'webGlBasics.value.rendererUnmasked','webGlBasics.value.vendorUnmasked',
      'deviceMemory.value','hardwareConcurrency.value','screenResolution.value'])),
    xhh,                          // = fingerprintPromise (строка hex)
    fingerprintjs: t.visitorId,   // = FingerprintJS visitorId
  };
}
```

### Синтетический fingerprint

Расширение использует синтетический fingerprint: дефолтный профиль (`gen_0_дата`) генерируется один раз при старте работы (загрузка панели, проверка сессии на hh или первый тест) и сохраняется в настройках (`auto: true`). Все последующие тесты переиспользуют его независимо от перезапусков расширения и навигаций. Кнопка «Пересоздать» генерирует новый дефолтный профиль (свежие `visitorId`/`xhh`/хэши). Кнопка «Создать» добавляет ручной профиль (`gen_N_дата`), который имеет приоритет при выборе.

Модель профиля:

```json
{
  "id": "<8 hex>",
  "label": "gen_N_YYYY-MM-DD",
  "auto": true,
  "visitorId": "<32 hex>",
  "xhh": "<32 hex>",
  "hashes": {
    "strict_hash": "<64 hex>",
    "soft_hash": "<64 hex>",
    "hardware_hash": "<64 hex>"
  }
}
```

Генерация (`src/core/fingerprint.js`):
1. `generateComponents()` — синтетические компоненты ровно по путям формулы `W`: canvas geometry (data-URL, ~60 симв base64) / text (~40 симв), webGlBasics renderer/vendor (правдоподобные пары GPU/Vendor), webGlExtensions (реалистичные расширения), plugins, fonts, fontPreferences `{}`, screenResolution (1920×1080, 2560×1440, etc.), colorDepth 24, deviceMemory 8/16/32, hardwareConcurrency 4–16, math, audio.
2. Хэши — **по формуле `W`** (`Z(J(components, paths))`): `strict_hash`, `soft_hash`, `hardware_hash` из синтетических компонентов. `visitorId` и `xhh` — случайные 32-hex.
3. `last_id` = `SHA-256(userId)` из сессии пользователя hh.ru.

`redirect_to_test` собирается из профиля: `strict_hash`/`soft_hash`/`hardware_hash` = `profile.hashes`, `xhh` = `profile.xhh`, `fingerprintjs` = `profile.visitorId`, `last_id` = SHA-256(userId).

### Вывод для API-солвера

Автостарт теста выполняется клиентски:
1. Формируется URL `redirect_to_test?strict_hash=...&soft_hash=...&hardware_hash=...&xhh=...&fingerprintjs=...&skill_id=<id>&kind=<theory|practice>&id=<method.id>&origin=<origin>&skill_category=<skills|langs>&last_id=<...>&hhtmFrom=skill_assessment_current`.
2. Выполняется навигация на redirect URL.
3. Сервер возвращает 302 с установкой cookie `contest_token` → дальше чистый API-цикл (раздел 4).

Примечания:
- `securePortalFingerprintPromise` (`288ee6a8...`) в redirect не используется — вероятно, для других флоу (secure portal); можно игнорировать.
- GIB `api/fl` (POST, зашифрованный пейлоад 12–13 KB) страница шлёт при `gib.flash()` — для клиентского автостарта его можно не воспроизводить (redirect работает без него, см. раздел 3), но он обновляет cookies `cfidsgib-w-hh`/`gsscgib-w-hh`, которые страница передаёт в заголовках `api/fl` и OTT-заголовках.
- FingerprintJS: `canvas.geometry` — data-URL отрисовки (стабилен), `webGlBasics.rendererUnmasked` — «ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Ti ...)» и т.д. — всё детерминировано для данной машины.

## 4. Assessment API (всё подтверждено живыми тестами)

### Заголовки всех `/shards/*` запросов

```
X-Requested-With: XMLHttpRequest
Accept: application/json
X-XSRFToken: <значение cookie _xsrf>
X-Hhtmsource: CertTests          (+ пустые X-Hhtmfrom, X-Hhtmsourcelabel, X-Hhtmfromlabel)
Referer: https://assessment.hh.ru/tests/<skillId>
Origin: https://assessment.hh.ru
cookie: contest_token=<uuid>
```

### get_current_task

```http
GET /shards/cert_tests/get_current_task
```

```json
{
  "answers": [{"answer": "Текст варианта", "uuid": "<answer-uuid>", "feature": "false"}],
  "description": "Текст вопроса",
  "subType": "SINGLE",
  "taskId": 33555,
  "title": "Название набора",
  "media": []
}
```

- `subType`: `SINGLE` / `MULTIPLE` (несколько вариантов); `media` — прикреплённые материалы.
- После последнего вопроса → **`204 No Content`**.
- **Всегда отдаёт текущий (нерешённый) вопрос**: повторные GET без submit возвращают тот же `taskId`. Прогресс движется только сабмитами.

### get_contest_tasks

```http
GET /shards/contest/get_contest_tasks
```

```json
{"contestTasks": [{"taskId": 35166, "status": "NOT_STARTED"}, {"taskId": 33555, "status": "NOT_STARTED"}]}
```

### get_time_left

```http
GET /shards/contest/get_time_left
```

```json
{"timeLeftSeconds": 899}
```

### submit_user_answer

```http
POST /shards/cert_tests/submit_user_answer
Content-Type: application/json
```

```json
{"userAnswerUuids": ["<answer-uuid>"], "taskId": 35166}
```

Ответ: `{"status":"ACCEPTED"}`. Подтверждено 25/25 сабмитов (15 в JS Advanced, 10 в Python theory), включая сабмиты чистым `fetch()` из контекста страницы.

### post_finish

```http
POST /shards/contest/post_finish
```

Пустой multipart (FormData без полей, `Content-Length: 44`). Ответ:

```json
{"redirectUri": "https://spb.hh.ru/skills/applicant/contest_result?entrypoint=NEW_USER&token=<contestToken>"}
```

### Штатная последовательность перехода к следующему вопросу

(хроника JS Advanced, подтверждена на всех 15 переходах)

```
GET  /shards/contest/get_time_left
GET  /shards/contest/get_contest_tasks
POST /shards/cert_tests/submit_user_answer
POST /shards/contest/report_data     (type 10, финальный heartbeat)
GET  /shards/cert_tests/get_current_task
POST /shards/contest/report_data     (type 10 на новый taskId)
```

Финал: `submit_user_answer` → `get_current_task` (204) → `post_finish` → `GET spb.hh.ru/skills/applicant/contest_result`.

### Полный API-цикл решения (подтверждено 2026-08-11, Python theory, 10 вопросов)

1. `GET get_current_task` → вопрос; повторять до `204`.
2. `POST submit_user_answer {userAnswerUuids, taskId}` → `ACCEPTED`.
3. `POST post_finish` (пустой FormData) → `redirectUri` с contestToken.

DOM-взаимодействие не нужно вовсе. Запросы идут из контекста страницы assessment (cookie `contest_token` + `X-XSRFToken` + `X-Requested-With`). Фоном страница шлёт `report_data` (heartbeat type 10, `payload:[0]`) и `get_time_left`.

### Страница результата contest_result (подтверждено 2026-08-11, теория 4/10 → FAILURE)

После `post_finish` браузер получает `redirectUri` вида
`https://spb.hh.ru/skills/applicant/contest_result?entrypoint=NEW_USER&token=<contestToken>`
и грузит эту страницу — это и есть страница завершения с вердиктом. Результат
читается из SSR-шаблона `<template class="SkillsFront-InitialState">`
(двойно экранированный JSON: кавычки `&quot;`, обратные слэши удвоены;
в открывающем теге могут быть доп. атрибуты, искать надо по `class="…"`).

Ключ состояния `applicantContestResultPage`:

```json
{
  "desktopUiLayout": {
    "level": {"id": 8, "name": "Базовый"},
    "score": {"max": 10, "actual": 4},
    "contestResultStatus": "FAILURE",
    "nextAction": {"actionType": "GO_TO_SKILLS", "nextContest": null, ...},
    "infoCards": [
      {"type": "RESULT_DETAILS", "infoCardValue": "HIDDEN",
       "additionalProperties": {"date": "2026-09-11T00:00:00+03:00"}}
    ]
  },
  "method": {
    "id": 122, "name": "API", "category": "SKILL",
    "result": {
      "level": {"id": 8, "name": "Базовый"},
      "availableAt": "2026-09-11T00:00:00+03:00",
      "validUntil": null,
      "state": "NONE",
      "theory": "FAILURE",
      "practice": "NOT_EXIST"
    }
  }
}
```

Разбор:
- `desktopUiLayout.score.actual / .max` — правильных ответов из общего числа.
- `desktopUiLayout.contestResultStatus` — вердикт: `SUCCESS` | `FAILURE`.
- `method.result.theory/practice` — то же по методам; `availableAt` — когда
  можно пересдать (при фейле ≈ через месяц), `validUntil` — срок подтверждения.
- `infoCards[RESULT_DETAILS].additionalProperties.date` — дата следующей попытки.

Есть и вспомогательный виджет отчёта:
`GET https://career.hh.ru/career_platform/proxy_components/entrypoint_widget?entryPoint=REPORT_STATUS&skillId=<id>&verificationMethodId=<id>&resultType=<bool>`
— `resultType` здесь уже готовый булев вердикт (0/1).

## 4.1 Code-тесты (практика): страница, API-цикл, финал (подтверждено 2026-08-11, PHP 4/4, SUCCESS)

Практические (code) тесты идут по `assessment.hh.ru/code/<skillId>` — это отдельный контур `cert_code` (не `cert_tests`).

### Старт и страница задачи

```
POST spb.hh.ru/api/fl?u=...&cfidsgib-w-hh=...        (GIB fingerprint, как при теории)
GET  spb.hh.ru/skills/applicant/keyskills/verification_methods/redirect_to_test
     ?strict_hash=...&soft_hash=...&hardware_hash=...&xhh=...&fingerprintjs=...
     &skill_id=<skillId>&kind=practice&id=<practice.id>&origin=...&skill_category=skills
     &last_id=...&hhtmFrom=skill_assessment_current   → 302
GET  assessment.hh.ru/code/<skillId>?contestToken=<uuid>   → 302 (cookie contest_token)
GET  assessment.hh.ru/code/<skillId>                  → 200 HTML
```

SSR: `<template class="AssessmentFront-InitialState">`, ключ `pageCertCode` (двойно заэкранированный JSON):

```json
{
  "skillId": 3750,
  "taskId": 39389,
  "task": {
    "taskId": 39389,
    "title": "Фильтрация комментариев",
    "taskDescription": {
      "description": ["..."],
      "inputFormat": ["..."],
      "outputFormat": ["..."],
      "examples": [{"input": "...", "output": "..."}]
    }
  },
  "displayData": {"level": 1, "tags": ["..."]},
  "tests": {
    "adminTests": [{"id": "12969", "name": "Пример 1", "expectedOutput": "...", "input": "..."}],
    "userTests": []
  },
  "taskCounter": {"current": 3, "count": 4},
  "editor": {"progLanguage": "PHP", "solutionText": "<base64 шаблона>"},
  "timeLeftSeconds": 2083,
  "isTestTask": false,
  "finishModalType": "WARN_USER_NEXT_ATTEMPT_TIME"
}
```

Ключевые факты:
- `editor.solutionText` — base64 (UTF-8) шаблона, который виден в редакторе; **это и есть содержимое `code`, которое отправляется на проверку**.
- **SQL-задачи (`progLanguage=SQL`)** — исключение: `editor.solutionText` ПУСТ, схема и данные лежат в `task.taskDescription`:
  - `ddlScheme` — DDL-схема (CREATE TABLE …), живой клиент показывает на вкладке «Схема SQL» редактора (read-only);
  - `tableDescriptions` — `[{tableName, records: [{col: value, …}]}]` — тестовые данные, вкладка «Таблицы»;
  - `expectedTable` — `{records: […]}` — эталон результата, вкладка «Результат запроса» (отображается юзеру после прогона; в первый промпт НЕ включается, но в фикс-промпт после неудачного прогона попадает как оракул — зеркалит то, что видит человек).
  - В код/`update_code` для SQL уходит только сам запрос (SELECT…), без схемы (проверено захватом 2026-08-12: все update_code содержат только запрос).
- Для class-based задач шаблон = только класс (`namespace Solution { class ProcessData { ... } }`) — main-обвязку (чтение STDIN + вызов метода) сервер подставляет сам. Захвачено: задачи 2–4 отправляли только класс (`ProcessingGames::gamesReport`, `ProcessData::getValidData`).
- Встречается шаблон = main-файл (`require_once 'Solution.php'; ... $processor->getValidData($input)`) — сервер знает сигнатуру класса (`Solution.php` у него на стороне). В `code` уходило именно содержимое редактора; задача решается отправкой класса (заменой содержимого редактора целиком).
- `tests.adminTests` — видимые примеры; их `id` совпадают с `smokeTests` в результате прогона, `expectedOutput`/`input` можно использовать как локальный оракул.
- `taskCounter.current/count` — номер/всего задач; `timeLeftSeconds` — остаток на весь контест.
- На code-странице нет `get_contest_tasks`/`get_time_left` — таймер из SSR.

### Заголовки `/shards/cert_code/*`

```
X-Requested-With: XMLHttpRequest
Accept: application/json
X-XSRFToken: <cookie _xsrf>
X-Hhtmsource: CertCode          ← отличие от теории (CertTests)
Referer: https://assessment.hh.ru/code/<skillId>
Origin: https://assessment.hh.ru
cookie: contest_token=<uuid>
```

### Эндпоинты

| Метод/путь | Тело | Ответ |
|---|---|---|
| `POST /shards/cert_code/update_code` | `{"taskId": 34648, "code": "<base64>", "lang": "PHP", "isBeta": false}` | `{}` |
| `POST /shards/cert_code/post_submit_task` | `{"taskId", "code": "<base64>", "lang", "submissionType": "check"\|"full", "isBeta": false}` | `{"submissionId": 52198164}` |
| `GET /shards/cert_code/get_submit_task_result?submissionId=<id>&taskId=<id>&isBeta=false&isSolution=false\|true` | — | `{"smokeTests": {...}, "invisibleTests": {}, "userTests": {}, "status": "ACCEPTED"\|"WRONG_ANSWER", "commonError"?: "<текст компилятора>"}` |
| `POST /shards/cert_code/reset_code` | `{"taskId", "isBeta"}` | `{"solutionText": "<base64 шаблона>"}` |
| `PUT /shards/cert_code/update_test_case` | (тест) | — |
| `GET /shards/cert_code/get_test_case` | params `{taskId, isBeta}` | тест |

- `submissionType: "check"` — прогон тестов (кнопка «Запустить»); `"full"` — финальная отправка решения («Отправить решение»).
- `isSolution=false` — результат прогона; `isSolution=true` — результат отправки решения.
- **Кодирование кода** (из бандла, модуль 16677, функция `Ne`): UTF-8 → base64:
  `const t = new TextEncoder().encode(code); return btoa(String.fromCodePoint(...t))` — то есть UTF-8-безопасный base64. Для `post_submit_task` код дополнительно `.trim()`; для `update_code` — без trim.
- `get_submit_task_result` отдаёт готовый результат одним запросом (~2 с после POST); структура `smokeTests`: `{"<id теста>": {"passed": bool, "output": "<фактический вывод>"}}` — `output` всегда фактический, ожидаемое в ответе НЕТ (брать из `adminTests`).
- Захваченные статусы: `ACCEPTED` (все smoke прошли), `WRONG_ANSWER` (часть упала, `passed:false`).
- **Ошибка сборки (подтверждено 2026-08-12, Go)**: если код не компилируется, `smokeTests` ПУСТ (прогон «0 из 0»), а ответ содержит `commonError` — текст компилятора, напр. `# command-line-arguments\n./Runner.go:22:6: main redeclared in this block\n\t./Solution.go:3:6: other declaration of main`. Вывод: раннер сервера — отдельный файл (`Runner.go`), который добавляет свою точку входа; шаблон задачи — `package main` БЕЗ `func main`, повторное объявление main ломает сборку. Солвер обязан показывать `commonError` модели в фидбеке, иначе ретраи идут вслепую.
- **lang в post_submit_task**: значение `editor.progLanguage` из SSR — не «Go», а `GO_LANG` (PHP остаётся «PHP»); неверный lang → 400 с пустым телом.
- Телеметрия: `POST /shards/contest/report_data` — тот же формат, что в разделе 5. На code-странице зафиксированы (реальные тела, задача 4):
  - **type 5** (handleCodeEdited — ввод в редакторе): `{"payload":[4,0,1005]}` — [сим-клавиши, delete, длительность мс]. Возникал в момент вставки/правки кода;
  - **type 10** (heartbeat): `payload:[0]` обычно; один раз `[1]` (счётчик нарушений = 1 — вероятно, от переключения вкладок);
  - **type 3 (paste) НЕ зафиксирован**, хотя пользователь активно копировал и вставлял код — вставка в Monaco регистрируется как type 5, а не как paste-детект.
- **Политика сервера к code-тестам лояльна**: контест засчитан (SUCCESS, 4/4) несмотря на копипаст кода, переключения между вкладками и счётчик нарушений `[1]` в heartbeat. Для code-задач вставка кода — нормальное действие, и переключения фокуса не блокируют зачёт (в отличие от теории, где связка type 8 + type 10 решающая).

### Полный цикл задачи (захват 4 задач, PHP)

```
POST update_code {taskId, code}                       → {}
POST post_submit_task {taskId, code, submissionType:"check"}  → {submissionId}
GET  get_submit_task_result?isSolution=false          → {smokeTests, status}
  └─ если WRONG_ANSWER: правим код → снова check
POST post_submit_task {taskId, code, submissionType:"full"}   → {submissionId}
GET  get_submit_task_result?isSolution=true           → финальный вердикт
```

После `full` фронт перезагружает приложение (повторные GET статики), `GET /code/<skillId>` отдаёт следующую задачу (`taskCounter.current+1`, новый `taskId` в SSR). Между задачами `update_code` не обязателен, но шлётся при изменении кода/переходе.

### Финал контеста

После отправки решения последней задачи:
```
GET /code/<skillId> → 302
GET https://spb.hh.ru/skills/applicant/contest_result?entrypoint=NEW_USER&token=<contestToken>
```
`contestToken` — тот же из cookie. Страница результата разбирается как в разделе 4 (`applicantContestResultPage`): для успешной практики — `contestResultStatus: SUCCESS`, «4 из 4», «Навык подтверждён».

## 4.2 Практика для LLM-солвера: контракт ответа и итерации (из src/prompts)

Смысл сдачи практики со стороны солвера описывается системным промптом `src/prompts/practice.ts` (`DEFAULT_CODE_SYSTEM`) и сборкой промпта `builder.ts` (`buildCodePrompt`, `summarizeSmokeTests`, `stripCodeFence`). Эти правила — контракт ответа модели; перед отправкой в редактор код очищается и нормализуется с помощью `stripCodeFence`.

### Контракт ответа (practice.ts)

- **Полный файл**: модель возвращает ПОЛНЫЙ итоговый рабочий файл целиком от первой строки до последней. Фрагмент, diff, пояснение, только изменённый метод — недопустимый ответ.
- **Нельзя менять** (остаётся дословно):
  - сигнатуру: имя класса и метода, список параметров, тип возвращаемого значения;
  - уже существующую структуру шаблона.
- **Импорты и заголовки**: если требуются дополнительные библиотеки (`#include`, `import`, `using`), они добавляются строго **В НАЧАЛО** файла к остальным директивам.
- **Не добавлять точку входа**: метод `Main`/`main` не добавляется, если его нет в шаблоне — среда запуска сама вызывает предоставленный метод через свой раннер.
- **Что реализовать**: сохранить структуру и удалить комментарии-заглушки («// ваш код», «return 0;» и т.п.).
- **Формат ответа**: строго **ОДИН** блок кода в тройных кавычках ``` (` ```\n<полный код файла>\n``` `). Запрещено писать любой текст до или после блока кода (никаких пояснений и рассуждений).

### Нормализация ответа и сборка промпта (builder.ts)

- `stripCodeFence`:
  - Вырезает reasoning-блоки рассуждений модели (`<think>...</think>`, `<thought>...</thought>`).
  - Извлекает все блоки кода ` ```...``` `, отбрасывая весь окружающий и промежуточный естественный текст.
  - Если модель разбила ответ на несколько блоков кода, автоматически обнаруживает директивы импорта (`#include`, `import`, `using`, `package`) и переносит их в самое начало итогового файла.
- `buildCodePrompt`: раскладывает SSR (`pageCertCode`, docs §4.1): описание задачи, формат ввода/вывода, примеры, шаблонный код в ```-фенсе. Структура: `task` может быть обёрнут (`task.task`), а `tests.adminTests` лежит на верхнем уровне.
- Повторные итерации (решение не прошло): в промпт добавляются результаты последнего прогона (`summarizeSmokeTests`) и предыдущая версия решения — модель возвращает ПОЛНЫЙ исправленный файл.
- `summarizeSmokeTests`: сводит `smokeTests` из `get_submit_task_result` к списку строк: `- Тест <id>: PASSED/FAILED — фактический вывод: "..." (ожидалось: "...")`. Ожидаемый вывод джойнится из `adminTests` (docs §4.1) — локальный оракул для фидбека. **SQL-исключение (2026-08-13)**: у табличных задач adminTests без `expectedOutput`, поэтому для проваленных тестов оракулом служит `expectedTable` из SSR (рендер `records` как JSON) — иначе фикс-петля слепая и модель крутит формат вместо условия (кейс «Подсчет сметы», 11 прогонов 0/1).

### Влияние на API-цикл

- Первый прогон обычно `submissionType:"check"`; при `WRONG_ANSWER` правки идут итерациями (check → фидбек → check), финальная отправка — `submissionType:"full"`, как в §4.1.
- Так как контракт требует полный файл, `post_submit_task` уезжает на сервер именно содержимым редактора (base64 UTF-8, `Ne`, docs §4.1); класс-обёртки и main-обвязка — зона сервера, модель их не добавляет.
- Если лимит правок исчерпан (по умолчанию `maxFixAttempts = 5`) — солвер не прерывает контест: последняя попытка отправляется как `full`, задача считается проваленной в вердикте, цикл переходит к следующей задаче (событие `code-skipping` + `code-submitted {skipped:true}`).

## 5. Телеметрия report_data (актуальная сборка, 2026-08-10)

Источник: разбор чанков текущей сборки (`static/8355.*.js` — модуль 35270, `static/src-pages-CertTests-CertTests-route.*.js`, `static/8859.*.js` — Sentry/Replay) + наблюдения сессии 2026-08-10 (C#, классический тест, 10 вопросов).

Формат POST `https://assessment.hh.ru/shards/contest/report_data`:

```json
{"data": [{"taskId": <id>, "type": <N>, "timestamp": "ISO+03:00", "payload": [...]}], "taskId": <id>}
```

### Таблица типов событий

| type | handler | что | payload | асинхронно |
|---|---|---|---|---|
| 1 | handleWindowFocus/Blur | потеря/возврат фокуса ОКНА | `[0\|1, длительность вне фокуса мс]` | сразу по возврату фокуса |
| 2 | handleWindowResized | изменение размера окна | `[dX, dY]` (debounce 500 мс) | сразу |
| 3 | handleCodePasted | вставка в редактор кода | `[хэш вставленного, область]` | сразу |
| 4 | handleCodeCopied | копирование из редактора кода | `[хэш скопированного]` | сразу |
| 5 | handleCodeEdited | ручной ввод в редакторе | `[сим-клавиш, delete, длительность]` | буфер → пачка каждые 10 с |
| 6 | handleTextCopied | копирование текста из поля ответа | `[хеш текста]` | сразу |
| 7 | handleQuestionCopied | копирование текста вопроса | `[хеш текста]` | сразу |
| 8 | handleChooseAnswer | выбор варианта ответа | пусто | сразу |
| 9 | handleFailedToDetect | **обнаружен тамперинг событийного конвейера** | `[причины]` | сразу + каждые 30 с |
| 10 | handleHeartBeat | heartbeat счётчика нарушений | `[totalDetectedEvents]` | сразу + каждые ~20 с |

> ⚠️ В текущей сборке payload type 10 — **счётчик нарушений** (`localStorage['detectedEvents']`), а не номер выбранного варианта (так было в старой сборке 2.53.93). Легитимный паттерн: «ответ → heartbeat [1] → heartbeat [0]».

Механика:
- каждая детекция: `localStorage.setItem("detectedEvents", +1)`; heartbeat читает и сбрасывает;
- `handleCodeEdited` (5) буферизуется и шлётся раз в 10 с (`analyticSendInterval = 10000`);
- при сабмите ответа вызывается `endHeartBeat` (type 10 с итоговым счётчиком);
- потерянное событие (502) клиент не повторяет.

Наблюдения сессии 2026-08-10: 10× type 8 (по числу ответов), 22× type 10 с чередованием `[0]/[1]`; copy/paste, blur/focus, resize не триггерились.

### Точки подключения детекторов (код → событие)

- **Окно**: `window` focus/blur — только при `!document.hidden`; на blur фиксируется `windowFocusLostTime`, на focus шлётся type 1.
- **Вкладка**: `document.visibilitychange` — `document.hidden` → таб-блур (засечь время), иначе → таб-фокус, type 1 payload `[0, мс]`.
- **Ресайз**: `window.resize` (debounce 500 мс) → type 2.
- **Копирование вопроса**: `QuestionDescription onCopy`: `window.getSelection().toString()` → type 7.
- **Выбор ответа**: SingleChoice/MultipleChoice на смену значения → type 8.
- **Копирование/вставка кода** (чанк редактора): на copy → `copiedData = hash`, `copiedArea = Editor`; на paste сверяется хэш: не совпал → `copiedArea = Other` («чужой источник», type 3).
- **Ввод в редакторе**: «символьные/delete + длительность» → type 5.

### Анти-тампер проба (canary)

Чанк `CertTests-route`, antiDetector (`checkInterval=30_000`):

```js
Promise.allSettled([
  // 1) свой listener "visibilitychange" (capture) + ручной dispatchEvent;
  //    если слушатель НЕ вызван → «Event handling pipeline disruption»
  new Promise(res => {
    let ok = false;
    document.addEventListener("visibilitychange", () => { ok = true }, { capture: true });
    document.dispatchEvent(new Event("visibilitychange"));
    setTimeout(() => res(!ok), 0);
  }),
  // 2) Object.getOwnPropertyDescriptor(document, "hidden") — собственное
  //    проперти (overridden) = «DOM property descriptor inconsistency»
  !!Object.getOwnPropertyDescriptor(document, "hidden")
])
```

Обнаружение → `handleFailedToDetect` (type 9) + UI-сообщение. Смысл: перекрытие `visibilitychange`/`dispatchEvent` (проки, эмуляторы) или присваивание `document.hidden` напрямую → флаг-подозрение.

### Sentry Replay (rrweb)

`8859.js` — `@sentry/browser` + Replay: `replaysSessionSampleRate: 3`, `replaysOnErrorSampleRate: 7`, `sessionSampleRate: 10`; записывает мышь (mousemove sampling 50 мс), клики, скролл, ввод; флашинг по `visibilitychange → hidden`; передача `sentry.hh.ru`. Не строгий детектор, но источник записи сессии для ручной проверки.

### Вывод по защите

Два уровня:
1. **Реактивный антифрод** (на странице теста): copy/paste с хэшами, потеря фокуса окна/вкладки с замером времени, resize, темп ввода, выбор ответа → в `report_data`, счётчик в localStorage, heartbeat (~20 с) + флаш на финише.
2. **Проактивные пробы**: canary (type 9), FingerprintJS перед стартом, Sentry-replay.

Сервер разбирает связку type 8 + type 10 + счётчик `detectedEvents` — именно это решающе для оценки попытки.

## 6. Фильтр телеметрии report_data (шлюз телеметрии вкладки солвера)

> Текущий статус: фильтр восстановлен и встроен в шлюз (`src/core/telemetry-gate.js`).
> Старый отдельный `src/guard.js` (инъекция `installReportGuard`) удалён, его
> транспортная схема переработана под шлюз. Ниже — описание исходного
> guard-режима для истории; актуальная схема — в начале раздела.

### Актуальная схема (шлюз, src/core/telemetry-gate.js)

Шлюз перехватывает ВСЕ report_data на вкладке солвера (XHR/fetch/beacon) и:

- **Скрывает детекторные типы** по контуру вкладки:
  - теория (`/tests/*`): `{1,2,3,4,5,6,7,9}` — в т.ч. type 5 (на теории нет редактора);
  - практика (`/code/*`): `{1,2,3,4,6,7,9}` — type 5 (ввод кода) **пропускается**: его шлёт сама «печать» решения, и это единственное событие, доказывающее активность в редакторе;
  - `{8,10}` проходят всегда (type 8 — выбор ответа, инжектируется шлюзом; type 10 — heartbeat'ы страницы и счётчик после инжекта).
- **Переписывает `taskId`** у оставшихся событий на текущий вопрос/задачу (страница стучит taskId первого вопроса).
- **Корректирует счётчик нарушений** в type 10: `payload[0]` уменьшается на число скрытых в этом же теле событий (не уходит в минус).
- Если после фильтрации событий не осталось — запрос **не уходит**, вызывающему отдаётся синтетический успех (status 200, `{}`).
- Свои инжекты (type 8/5 через `gateAction`) фильтру не подлежат — они содержат только разрешённые типы.

Мотивация (эксперимент 2026-08-12): теория, пройденная с разовым blur 6,4 с (type 1), и проваленная с тремя blur (2,0 / 25,7 / 11,4 с) при идентичных ответах — длительные потери фокуса окна решают против попытки. Пройденная практика (Python base, 3/3) шла без единого type 1 — вкладка всё время в фоне. Блур на вкладке солвера возможен только если пользователь переключается на неё, т.е. это всегда «настоящее» нарушение — фильтр их прячет.

### Историческая схема guard.js (удалена)

Статус (исторический): реализовано — `src/guard.js` (инъекция через `chrome.scripting` в MAIN world), тесты `tests/guard.test.js`.

### Решение

- **Счётчик не патчим**: `detectedEvents` — сумма всех событий с последнего heartbeat, включая легитимные type 8; паттерн «ответ → heartbeat [1] → heartbeat [0]» должен оставаться натуральным.
- **Фильтруем на транспорте (XHR/fetch/beacon)** POST `/shards/contest/report_data`:
  - убираем типы `{1,2,3,4,5,6,7,9}` (неден-лист — новые типы будущих сборок не отбрасываются молча);
  - type 8 и type 10 проходят как есть;
  - счётчик в payload type 10 корректируется на число скрытых событий;
  - если после очистки событий не осталось — POST не отправляется, вызывающему отдаётся синтетический успех.
- **Canary (type 9) не задевается**: не трогаем `visibilitychange`, `dispatchEvent`, `document.hidden`, `addEventListener`, `MutationObserver`.

### Архитектурная встройка

```text
background: sweepTab()
   ├── collectPageData()  -> ... + guardReady: Boolean(document.documentElement.__hhGuard)
   └── если (kind=test|code) и !guardReady
         └─ chrome.scripting.executeScript({ world:'MAIN', func: installReportGuard })
```

- `installReportGuard` автономна (без замыканий — сериализуется в executeScript); маркер `document.documentElement.__hhGuard = '1'` (идемпотентность; после навигации маркер исчезает — guard ставится заново);
- перехват `XMLHttpRequest.prototype.open/send`, `window.fetch` — только URL `*/shards/contest/report_data`;
- guard ставится только на вкладках `isAssessmentUrl` (`/tests/*`, `/code/*`); молчит (без console-шума).

### Реализация (псевдокод, соответствует src/guard.js)

```js
export function installReportGuard() {
  if (document.documentElement.__hhGuard) return;
  document.documentElement.__hhGuard = '1';

  const STRIP = new Set([1, 2, 3, 4, 5, 6, 7, 9]);
  const isReport = u => typeof u === 'string' && u.indexOf('/shards/contest/report_data') !== -1;

  let hiddenCount = 0;

  const fix = raw => {
    if (typeof raw !== 'string') return { body: null, sent: false, remove: 0 };
    let p;
    try { p = JSON.parse(raw); } catch { return { body: null, sent: false, remove: 0 }; }
    if (!Array.isArray(p?.data)) return { body: null, sent: false, remove: 0 };

    let removed = 0;
    const kept = [];
    for (const ev of p.data) {
      const t = ev && ev.type;
      if (t === 10) {
        if (hiddenCount > 0 && Array.isArray(ev.payload) && ev.payload[0] != null) {
          ev.payload[0] = Math.max(0, Number(ev.payload[0]) - hiddenCount);
          hiddenCount = 0;
        }
        kept.push(ev);
      } else if (STRIP.has(t)) {
        removed++;
        hiddenCount++;
      } else {
        kept.push(ev);
      }
    }
    if (!removed) return { body: null, sent: false, remove: 0 };
    p.data = kept;
    return { body: JSON.stringify(p), sent: kept.length > 0, remove: removed };
  };

  const oOpen = XMLHttpRequest.prototype.open, oSend = XMLHttpRequest.prototype.send;
  const symUrl = Symbol('__hhReportUrl');
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string') this[symUrl] = url;
    return oOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (!isReport(this[symUrl])) return oSend.apply(this, arguments);
    const { body: clean, sent } = fix(body);
    if (sent && clean) return oSend.call(this, clean);
    if (!sent) {
      try {
        this.status = 200; this.readyState = 4; this.responseText = '{}';
        if (this.onreadystatechange) this.onreadystatechange.call(this, { type: 'readystatechange' });
        if (this.onload) this.onload.call(this, { type: 'load' });
      } catch {}
      return undefined;
    }
    return oSend.apply(this, arguments);
  };

  const oFetch = window.fetch;
  window.fetch = function (input, init) {
    const u = typeof input === 'string' ? input : (input && input.url);
    if (!isReport(u)) return oFetch.apply(this, arguments);
    const body = init && init.body;
    const { body: clean, sent } = fix(typeof body === 'string' ? body : null);
    if (!sent) return Promise.resolve(new Response(JSON.stringify({}), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    return oFetch.call(this, input, { ...init, body: clean });
  };
}
```

### Что guard НЕ трогает

- `submit_user_answer`, `get_current_task`, `post_finish` — штатная логика решения.
- Семантика type 10 (счётчик) — переписывается только вычет скрытых событий.

### Чек-лист верификации (CDP-перехватчик, `recorder/capture.mjs`)

- [ ] прогон без guard: трейс содержит только type 8/10;
- [ ] прогон с guard: нет типов 1–7,9; type 8/10 на месте; heartbeat `[n]` согласован;
- [ ] canary не всплывает (нет модалки тамперинга);
- [ ] `submit_user_answer` / post_finish не изменены;
- [ ] после навигаций guard переустанавливается (маркер).

## 7. Нативный ввод в редактор кода (справка, актуально для code-задач)

Редактор кода перепечатывается целиком (очистка + посимвольный ввод) через `document.execCommand('insertText')` — нативный путь браузера:

- `input`/`beforeinput` приходят trusted (isTrusted === true), неотличимы от ручного ввода;
- не создаёт paste-событий и ClipboardData;
- очистка через Ctrl+A + Backspace — штатное keybinding Monaco;
- на время ввода у Monaco отключаются `autoClosing*`/`autoIndent` (иначе «честная» печать добавила бы `{}` и сдвинула отступы), затем возвращаются.

Ограничение: серверный анализ (GIB-подпись, bobid-ip.hybrid.ai, timing) остаётся за пределами этой защиты.

## 8. Что НЕ подтверждено (границы знаний)

- Серверный timing-анализ (равномерные ~2-секундные интервалы между `get_current_task` и `submit_user_answer`) — гипотеза; в эксперименте человек сам быстро отвечал без блокировки.
- `bobid-ip.hybrid.ai` — кандидат на бот-детекцию (имя прямо указывает), но запрос происходил один раз на странице результата, не во время теста.
- `_ym_isad=2` (Yandex Metrika automation-флаг) — наблюдение, не доказано что hh.ru его читает.
- Детект расширений пользователя: страница может искать лишь косвенные признаки (web-accessible resources, блокировка ресурсов, изменение API/DOM); прямого детекта не найдено ни в старой, ни в текущей сборке assessment.
- AntifraudModal («Доступ к тестам ограничен») существует в React state, но в наших экспериментах не срабатывала.
- Ошибки `net::ERR_BLOCKED_BY_CLIENT` (реклама/расширения) — не подтверждено, что assessment использует их как сигнал.
- Содержимое зашифрованного GIB-пейлоада `api/fl` не декодировано.
- Code-тесты: тело ответа `get_submit_task_result?isSolution=true` (содержимое `invisibleTests` при финальной отправке) не захвачено — после навигации DevTools не отдал тело; структура восстановлена по аналогии с `isSolution=false` (подтверждены только `smokeTests`/`status` и факт перехода к финалу). `invisibleTests`/`userTests` в прогонах были пустыми.
- Переход к следующей задаче после `full` с **неверным** решением (пропуск задачи солвером) — в живых захватах после `full` всегда следовал следующий таск, но решение при этом было верным; что сервер делает при неверном `full` (продолжает контест или завершает с FAILURE) не проверено живым экспериментом.
