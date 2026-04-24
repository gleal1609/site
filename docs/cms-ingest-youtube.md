# Admin → GitHub Actions → R2: gerar capa + prévia do YouTube

Este documento explica, passo a passo, como ligar o botão **«Gerar capa e prévia (GitHub Actions)»** do painel admin ao workflow que processa o vídeo do YouTube com `yt-dlp` + `ffmpeg`, envia os ficheiros para o Cloudflare R2 e actualiza a base de dados D1. É gratuito (plano free do GitHub Actions) e não precisa de correr nada no teu computador.

## Visão geral

```
Admin (browser)
  │  POST /api/projects/<slug>/ingest-youtube
  ▼
Cloudflare Worker
  │  POST https://api.github.com/repos/<owner>/<repo>/dispatches
  ▼
GitHub Actions — workflow «Ingest YouTube media»
  │  yt-dlp (descarrega o vídeo do YouTube)
  │  ffmpeg (capa JPEG e clip 5 s MP4, usando os instantes do D1)
  │  S3 API → R2 (bucket `reverso-media`, chaves `projects/<slug>/yt-poster.jpg` e `projects/<slug>/hover-5s.mp4`)
  │  POST /api/projects/media-keys (Worker) → UPDATE D1 `thumbnail` + `hover_preview`
  ▼
Próximo «Publicar» ou reabrir o editor: a Home reflecte os novos ficheiros após o deploy da Netlify.
```

Uma ingestão típica demora **2 a 5 minutos**; quota grátis de GitHub Actions é mais que suficiente.

## Checklist rápido

1. [Criar um Personal Access Token (PAT)](#1-personal-access-token-github) para o Worker usar nos `repository_dispatch`.
2. [Adicionar esse token como secret do Worker](#2-secrets-do-cloudflare-worker) (`GITHUB_REPO`, `GITHUB_DISPATCH_TOKEN`).
3. [Adicionar os secrets do repositório](#3-secrets-do-reposit%C3%B3rio-github) usados pelo workflow (`R2_*`, `WORKER_API_BASE`, `CF_BUILD_TOKEN`).
4. [Fazer commit e push](#4-commit-e-push) — só depois do workflow estar no branch por defeito é que o dispatch funciona.
5. [Redeploy do Worker](#5-redeploy-do-worker) para a rota `POST /api/projects/<slug>/ingest-youtube` ficar activa.
6. [Testar](#6-testar-pelo-painel) no admin.

## 1. Personal Access Token (GitHub)

O Worker chama `POST /repos/<owner>/<repo>/dispatches`. Esta rota exige um token com permissões de escrita em **Contents** deste repositório (para PAT fine‑grained) ou scope `repo` (para PAT classic).

### Opção recomendada — **PAT fine‑grained** (acesso só a este repositório)

1. Abre <https://github.com/settings/personal-access-tokens> (menu «Fine‑grained tokens»).
2. `Generate new token`.
3. Preencha:
   - **Token name:** `reverso-cms-dispatch` (ou outro reconhecível).
   - **Resource owner:** a tua conta / organização.
   - **Expiration:** 90 dias é um bom compromisso (pode ir até 1 ano).
   - **Repository access:** `Only select repositories` → escolhe **este repositório**.
4. Em **Repository permissions**:
   - `Contents`: **Read and write** (obrigatório para `repository_dispatch`).
   - Todas as outras ficam `No access` (é o default).
5. `Generate token` e **copia o valor agora** (`github_pat_…`). Não volta a ser mostrado.

### Alternativa — PAT classic (mais simples de configurar)

1. <https://github.com/settings/tokens> → `Generate new token (classic)`.
2. Scopes: marca apenas **`repo`** (dá `repo:status`, `repo_deployment`, `public_repo` — suficiente).
3. `Generate token` e copia o valor.

> **Nunca** faças commit do token. Se exposto, regera.

## 2. Secrets do Cloudflare Worker

O Worker precisa de saber o repo alvo e o token. Faz no diretório `cf-worker/` (uma vez cada):

```bash
cd cf-worker
npx wrangler secret put GITHUB_REPO
# cola, por exemplo: reverso/site
npx wrangler secret put GITHUB_DISPATCH_TOKEN
# cola o PAT fine-grained OU classic (sem aspas)
```

Verificar (sem revelar valores): `npx wrangler secret list`.

Se preferires a interface web: **Cloudflare dashboard → Workers & Pages → reverso-cms-api → Settings → Variables → Secrets → Add secret** (adiciona as duas com o mesmo nome). Depois, `npx wrangler deploy` para publicar o código que consome essas variáveis.

> `.dev.vars` é para desenvolvimento local do Worker (`wrangler dev`); se quiseres testar localmente o dispatch também, acrescenta lá:
>
> ```
> GITHUB_REPO=reverso/site
> GITHUB_DISPATCH_TOKEN=github_pat_xxxxx
> ```

## 3. Secrets do repositório GitHub

Estes são lidos pelo workflow em tempo de execução (o token do passo 1 é lido pelo Worker, não pelo workflow). Vão em **Settings → Secrets and variables → Actions → New repository secret**.

| Nome | Valor / onde obter |
|------|--------------------|
| `R2_ACCOUNT_ID` | Cloudflare → R2 → vê o Account ID no canto superior direito (32 chars hex). |
| `R2_ACCESS_KEY_ID` | Cloudflare → R2 → **Manage R2 API Tokens** → *Create API token* → **Object Read & Write** só para o bucket `reverso-media`. Copia o **Access Key ID**. |
| `R2_SECRET_ACCESS_KEY` | Do mesmo token acima: **Secret Access Key**. Guarda-o imediatamente. |
| `R2_BUCKET` | *(opcional)* — omite para usar o default `reverso-media`. |
| `WORKER_API_BASE` | Base do Worker, **sem barra final**. Ex.: `https://reverso-cms-api.reverso-cms.workers.dev`. |
| `CF_BUILD_TOKEN` | O mesmo `BUILD_TOKEN`/JWT `read:export` que a Netlify usa para chamar `/api/projects/export`. |

> Para o token do R2, podes reutilizar o que já tens (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` no `.dev.vars`). **Não** coloques o valor de `.dev.vars` no repositório: adiciona-o directamente no GitHub como secret.

Para validar que os cinco secrets são aceites, o próprio workflow tem um passo «*Check secrets*» que aborta com uma mensagem clara se faltar algum.

## 4. Commit e push

Faz commit destes ficheiros novos/alterados e faz push para o branch principal (o `repository_dispatch` só é processado em workflows presentes no **branch por defeito**):

- `.github/workflows/ingest-youtube.yml`
- `cf-worker/src/index.js`
- `cf-worker/src/routes/ingest-youtube.js`
- `scripts/ingest-youtube-media.mjs`
- `admin/assets/js/admin-app.js`
- `admin/assets/js/cf-api.js`
- `admin/index.html`
- `docs/cms-ingest-youtube.md`

Abre **Actions** no GitHub e confirma que o workflow «Ingest YouTube media» aparece (sem ter corrido ainda).

## 5. Redeploy do Worker

Na pasta `cf-worker/`:

```bash
npx wrangler deploy
```

Verifica que a nova rota responde:

```bash
curl -i -X OPTIONS https://reverso-cms-api.reverso-cms.workers.dev/api/projects/fake-slug/ingest-youtube
# 204 No Content com cabeçalhos CORS = rota existe
```

## 6. Testar pelo painel

1. Abre o admin. Não é preciso configurar nada no browser; a CSP já permite chamar o Worker.
2. Abre um projeto que tenha `youtube_url` preenchido.
3. (Opcional) ajusta os instantes no bloco «Pré-visualização (YouTube IFrame API)» → «Guardar posição → instante da capa» / «Guardar posição → início do clip 5s» → **Salvar** → **Publicar**. Sem isto, o runner usa 0 s + 0–5 s.
4. Clique em **«Gerar capa e prévia (GitHub Actions)»** (só aparece se `youtube_url` estiver preenchido e o projecto já existir no servidor).
5. Aparece um toast com `actions_url`; clica em **«Ver execuções»** para seguir o log. Espera 2–5 min.
6. Quando terminar com sucesso, **reabre o projecto no editor** ou recarrega a lista: `thumbnail` e vídeo de hover já mostram os novos URLs de `projects/<slug>/yt-poster.jpg` e `projects/<slug>/hover-5s.mp4`.
7. Clica em **Publicar** só se quiseres forçar um novo deploy Netlify (o Worker já gravou em D1; o próximo deploy Netlify — agendado, manual ou por outro save — traz os novos valores para o site estático).

## Como corrigir se algo falhar

- **GitHub Actions tab → execução falha em «Check secrets»** → falta algum secret no repo (lista no passo 3).
- **Execução falha em «Install yt-dlp»** → rara — abrir o log; repetir costuma funcionar. `pip` pode ter cache corrompida.
- **Execução falha em «Ingest» com `Worker 401` / `403`** → `CF_BUILD_TOKEN` do repo não bate com o do Worker; regenerar com `cf-worker/scripts/generate-build-token.mjs` e actualizar o secret.
- **Execução falha com `R2 …`** → token R2 sem permissão `Object Read & Write` no bucket `reverso-media`, ou `R2_ACCOUNT_ID` errado.
- **Admin dá erro `GitHub recusou o token de dispatch`** → o PAT expirou ou não tem `Contents: RW` (fine‑grained) / scope `repo` (classic). Gera novo e actualiza `GITHUB_DISPATCH_TOKEN` no Worker.
- **Admin dá erro `GitHub 404`** → `GITHUB_REPO` não está no formato `owner/repo`, ou o PAT não tem acesso a este repo (fine‑grained com «Only select repositories» errado).
- **Admin dá erro `GitHub 422`** → o ficheiro `.github/workflows/ingest-youtube.yml` ainda não está no branch por defeito. Faz push para `main` / `master`.

## Manual — correr localmente (fallback)

O fluxo manual antigo continua disponível:

```bash
# Requisitos: Node 20+, yt-dlp, ffmpeg no PATH
export R2_ACCOUNT_ID=…
export R2_ACCESS_KEY_ID=…
export R2_SECRET_ACCESS_KEY=…
export WORKER_API_BASE=https://reverso-cms-api.reverso-cms.workers.dev
export CF_BUILD_TOKEN=…

cd scripts
npm install
node ingest-youtube-media.mjs --slug <slug>     # usa instantes do D1 (recomendado)
node ingest-youtube-media.mjs --all             # todos os projetos com youtube_url
```

## Custo / quotas

- GitHub Actions: 2 000 min/mês grátis em repositórios privados (3 000 no plano Pro); **ilimitado em repositórios públicos**. Uma ingestão custa ~2–5 min.
- Cloudflare R2: escrita grátis, armazenamento grátis até 10 GB, sem egress charges.
- Cloudflare Worker: 100 000 requests/dia grátis.

## Segurança

- O endpoint `POST /api/projects/<slug>/ingest-youtube` passa pelo `authMiddleware` + `checkRevocation` + `checkAllowlist` + CSRF do Worker — só utilizadores autenticados do admin podem disparar.
- O PAT só tem `Contents: RW` (ou `repo`) deste repo; não consegue aceder a outros.
- O workflow nunca recebe o PAT; os secrets usados dentro do workflow são diferentes (acesso R2 + `CF_BUILD_TOKEN`).
- O audit log do Worker regista cada dispatch (`action: ingest_youtube_dispatch`).
