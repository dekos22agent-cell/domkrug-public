# CI

Автоматический workflow для GitHub Actions подготовлен, но **не добавлен** в
`.github/workflows/ci.yml`: у текущего personal access token нет scope
`workflow`, и GitHub отклоняет push такого файла. Добавить его можно через
веб-интерфейс GitHub (Actions → New workflow) или токеном с `workflow`-scope.

## Что должен проверять CI

1. `npm ci` и `npm --prefix backend ci`;
2. миграции, seed и backfill кодов на PostgreSQL 16;
3. `npm --prefix backend run typecheck`;
4. `npm --prefix backend test` (32 юнит-теста);
5. `npm --prefix backend run build` и запуск API;
6. `API_URL=http://127.0.0.1:3000 npm --prefix backend run test:api`
   (100 API-тестов);
7. `npm run lint`, `npm test`, `npm run build`.

## Workflow

Вставить в `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: domkrug
          POSTGRES_PASSWORD: domkrug_dev_password
          POSTGRES_DB: domkrug_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U domkrug -d domkrug_test"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10

    env:
      NODE_ENV: test
      DATABASE_URL: postgresql://domkrug:domkrug_dev_password@127.0.0.1:5432/domkrug_test
      JWT_SECRET: test-secret-at-least-32-characters-000
      APP_HOST: 127.0.0.1
      APP_PORT: 3000
      APP_URL: http://127.0.0.1:3000

    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: |
          npm ci
          npm --prefix backend ci
      - run: |
          npm --prefix backend run migrate
          npm --prefix backend run db:seed
          npm --prefix backend run db:backfill-code-lookup
      - run: |
          npm --prefix backend run typecheck
          npm --prefix backend test
      - run: |
          npm --prefix backend run build
          nohup npm --prefix backend start > /tmp/api.log 2>&1 &
          for i in $(seq 1 30); do
            if curl -sf http://127.0.0.1:3000/health/ready >/dev/null; then exit 0; fi
            sleep 1
          done
          echo "API не поднялся"; cat /tmp/api.log; exit 1
      - run: API_URL=http://127.0.0.1:3000 npm --prefix backend run test:api
      - run: |
          npm run lint
          npm test
          npm run build
```

Пароль `domkrug_dev_password` и `JWT_SECRET` в workflow — тестовые, не
боевые: они действуют только внутри job и не дают доступа к прод-базе.
