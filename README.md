# UniShare — платформа взаємодопомоги студентів

Сайт у стилі X (Twitter): ліве меню розділів, центральна стрічка матеріалів і питань, праворуч — новини університету через API та AI-помічник на Claude API.

## Запуск

```bash
npm install
cp .env.example .env   # вкажіть ANTHROPIC_API_KEY і, за бажанням, NEWS_RSS_URL
npm start              # http://localhost:3000
```

## Структура

| Файл | Що робить |
|---|---|
| `server.js` | Express-сервер: REST API постів, новини (RSS → JSON, кеш 10 хв), AI-чат (Claude API, стрімінг SSE) |
| `public/index.html` | Каркас: ліве меню · стрічка · права колонка |
| `public/app.js` | SPA-роутер і всі сторінки |
| `public/styles.css` | Темна тема в стилі X, адаптив для планшета/телефона |
| `data/seed.json` | Демо-дані (копіюються в `data/db.json` при першому запуску) |

## Розділи (ліве меню)
Головна · Огляд (пошук) · Конспекти · Питання · Лабораторні · Екзамени · Предмети · Сповіщення · AI-помічник · Збережене · Профіль

## API
- `GET /api/posts?type=&subject=&q=&author=&saved=` · `POST /api/posts`
- `POST /api/posts/:id/like|save|solve` · `POST /api/posts/:id/comments`
- `GET /api/subjects` · `GET /api/notifications` · `GET /api/me`
- `GET /api/news` — RSS-стрічки з `NEWS_RSS_URL` (через кому); без неї — демо-новини
- `POST /api/ai/chat` — `{ messages: [{role, content}] }`, відповідь стрімом (SSE)

AI-помічник використовує модель `claude-opus-5-5` з адаптивним мисленням і серверним fallback на випадок відмови.
