# Documentação — Site Reverso Filmes (Jekyll)

Este documento descreve a estrutura do projeto na branch **`temp`** (versão completa: masonry na home, listagem de projetos, páginas internas e navegação inferior). A branch **`main`** pode estar mais enxuta; para desenvolvimento alinhado ao site em staging, use **`temp`**.

Inclui como rodar localmente, mapa de arquivos, fluxo de dados dos projetos, orientações para CMS / painel administrativo, **arquitetura do backend Cloudflare (D1 + R2 + Workers)** (implementado), segurança e procedimento de rollback.

---

## 1. O que instalar e configurar para rodar localmente

### 1.1 Pré-requisitos

| Ferramenta | Função |
|------------|--------|
| **Ruby** | Jekyll 4.4.x funciona bem com **Ruby 3.3.x** no Windows (RubyInstaller + Devkit). Evite versões muito novas se houver incompatibilidade com gems nativas. |
| **RubyGems** | Vem com o Ruby. |
| **Bundler** | `gem install bundler` — depois `bundle install` na pasta do site. |
| **Git** | Clonar, trocar de branch (`temp` vs `main`), deploy e CMS baseado em Git. |

**Windows:** O `Gemfile` inclui `tzinfo`, `tzinfo-data` e `wdm`. Se o **Controle Smart App** ou políticas bloquearem DLLs de gems (ex.: `json`), ajuste as políticas do Windows ou use **WSL2** para o ambiente Ruby.

### 1.2 Repositório e branch

```bash
git clone <url-do-repositorio>
cd site
git checkout temp
```

### 1.3 Comandos

```bash
bundle install
bundle exec jekyll serve
```

Abra **http://127.0.0.1:4000** (porta exibida no terminal). Use sempre `bundle exec` para respeitar o `Gemfile`.

**Com `netlify.toml` e fetch no build:** antes de `jekyll build` ou `jekyll serve`, o fluxo espera `node scripts/fetch-projects.mjs` (como no Netlify). Para testar **só o site** sem Worker ainda, pode: (1) gerar dados uma vez com o Worker + `CF_BUILD_TOKEN` e manter `_data/projects.json`; ou (2) criar `_data/projects.json` com `[]` para home vazia; ou (3) temporariamente usar `bundle exec jekyll serve` **sem** o passo do Node (ignorando o comando do `netlify.toml` no terminal local).

### 1.4 Observações

- **`.gitignore`** ignora `Gemfile.lock` — cada máquina gera o seu; em equipe, considere versionar o lock e remover essa linha para builds idênticos.
- **Assets pesados** (`/assets/img/projects/`, `/assets/video/projects/`, etc.): os Markdown em `_projects/` apontam para esses caminhos. Se as imagens/vídeos não estiverem no clone (Git LFS, entrega separada ou `.gitignore` local), a home e os detalhes aparecem com mídia quebrada até os arquivos existirem nessas pastas.
- **Deploy:** `README.md` referencia **Netlify**; o `_config.yml` usa `url` de staging (`temp.reversofilmes.com.br`).
- **Windows / PowerShell:** ao gravar `_projects/*.md` com `Set-Content -Encoding utf8`, o arquivo pode ganhar **BOM** no início. Se o Jekyll não reconhecer o front matter (`---`), a coleção `projects` fica vazia e `/projects.json` vira `[]`. Salve os `.md` como **UTF-8 sem BOM** ou remova os três bytes `EF BB BF` antes do primeiro `---`.

### 1.5 Comandos úteis

| Comando | Efeito |
|---------|--------|
| `bundle exec jekyll build` | Gera o site em `_site/`. |
| `bundle exec jekyll serve --livereload` | Servidor com recarregamento automático. |

---

## 2. Estrutura da aplicação (branch `temp`)

### 2.1 Visão geral

```
site/
├── _config.yml              # URL, tema Minima, coleção `projects`, defaults
├── _layouts/
│   ├── home.html            # Home: intro + grid masonry + scripts (GSAP, Packery, etc.)
│   ├── projects.html        # Página “Projetos” com filtros (Alpine.js)
│   ├── project.html         # Detalhe de um projeto (YouTube, Pixieset, corpo MD)
│   ├── about.html           # Sobre (layout dedicado)
│   └── curupire-se.html     # Página “Curupire-se”
├── _includes/
│   ├── header.html          # Font Awesome, favicons
│   ├── opengraph.html       # OG / Twitter
│   ├── projects-grid.html   # Grid da home + lógica de hover em vídeo
│   └── bottom-nav.html      # Barra inferior fixa (links internos e redes)
├── _projects/               # Arquivos .md legados (mantidos para rollback)
├── _data/projects.json      # Gerado em build pelo fetch script (gitignored)
├── _plugins/
│   └── data_page_generator.rb  # Gera /projects/:slug/ a partir de _data/projects.json
├── admin/                   # Visual Portfolio CMS (SPA) → consome Worker API
│   ├── index.html           # SPA principal (Alpine.js + Packery)
│   ├── config.yml           # Referência / fallback Sveltia CMS
│   └── assets/              # CSS (tema escuro) e JS (auth, cf-api, grid, editor)
├── cf-worker/               # Cloudflare Worker backend (D1 + R2)
│   ├── wrangler.toml        # Bindings D1, R2, crons, env vars
│   ├── migrations/          # Schema SQL versionado
│   └── src/                 # Middleware, rotas, utils, crons
├── scripts/
│   ├── fetch-projects.mjs   # Build-time: fetch D1 → _data/projects.json
│   ├── import-projects.mjs  # One-shot: _projects/*.md → D1
│   └── import-projects-sheet.mjs  # Planilha TSV/CSV → D1 (export Google Sheets)
├── netlify.toml             # Config-as-code (build, headers CSP, security)
├── assets/
│   ├── css/                 # main.css, bottom-nav.css
│   ├── js/                  # intro, transições, masonry (Packery), página de projetos, nav
│   ├── img/                 # Referenciado pelos projetos (pode não estar todo no Git)
│   └── video/               # Previews para hover (idem)
├── index.markdown           # layout: home
├── projects.markdown        # permalink /projetos/ → layout projects
├── projects.json            # Lista JSON (Liquid, usa site.data.projects || site.projects)
├── about.markdown           # /about/
├── curupire-se.md           # /curupire-se/
├── 404.html
├── Gemfile
└── README.md                # Convenção de nomes dos arquivos em _projects/
```

### 2.2 Configuração Jekyll (`_config.yml`)

- **Tema:** `minima` + plugin `jekyll-feed`.
- **Coleção `projects`:** `output: true`, permalink `/projects/:name/` — cada arquivo em `_projects/` vira uma URL (slug derivado do nome do arquivo).
- **Defaults:** entradas da coleção `projects` usam por padrão `layout: project`.

### 2.3 Rotas principais

| URL | Origem |
|-----|--------|
| `/` | `index.markdown` → `_layouts/home.html` |
| `/projetos/` | `projects.markdown` → `_layouts/projects.html` |
| `/projects.json` | `projects.json` (Liquid gera JSON com todos os projetos) |
| `/projects/<slug>/` | Gerado por `_plugins/data_page_generator.rb` a partir de `_data/projects.json` (fallback: `_projects/*.md`) |
| `/about/` | `about.markdown` |
| `/curupire-se/` | `curupire-se.md` |

### 2.4 Home (`_layouts/home.html`)

- Texto de introdução animado (**GSAP**) e container `#intro-text`.
- **`{% include projects-grid.html %}`:** lista projetos com `show_on_home: true`, ordenados por **`order`** (com desempate por data); cada card pode ter thumbnail, vídeo de hover (`hover_preview`) e metadados `data-size` (`home_size`, ex.: `2x2`) para o masonry.
- **`{% include bottom-nav.html %}`:** navegação inferior (Projetos, Curupire-se, Sobre, logo home, YouTube, Instagram, WhatsApp).
- Scripts: `page-transitions.js`, `home-intro.js`, `masonry-init.js` (usa **Packery** via CDN se necessário), `bottom-nav.js`.

### 2.5 Página Projetos (`_layouts/projects.html`)

- Carrega **`/projects.json`** no cliente.
- **Alpine.js:** busca, filtros por tipo de serviço e ano, **Ordenar:** Padrão (`order` no CMS), Data (mais recente primeiro) ou Tipo de Serviço (alfabético pelo primeiro tipo), sincronização com a URL (`#sort=date` / `service`); grid próprio (ver `assets/js/projects.js`, `projects-masonry.js`).

### 2.6 Detalhe do projeto (`_layouts/project.html`)

- Exibe título, cliente, ano, tags de serviço (com links de volta para `/projetos/` com âncora).
- **Thumbnail**, embed **YouTube** (`youtube_url`), iframe **Pixieset** (`pixieset_url`), corpo Markdown.

### 2.7 Front matter típico de um projeto (`_projects/*.md`)

Campos usados pelo site (ver também `README.md` e `projects.json`):

| Campo | Descrição |
|-------|-----------|
| `title` | Título exibido |
| `thumbnail` | Caminho da imagem (ex.: `/assets/img/projects/...-thumbnail.jpg`) |
| `hover_preview` | Vídeo curto no hover da home (opcional) |
| `service_types` | Lista (categorias para filtros) |
| `client` | Cliente |
| `date_mmddyyyy` | Data para ordenação |
| `year` | Ano |
| `show_on_home` | `true` para aparecer na masonry da home |
| `order` | Ordem no portfólio (home masonry e listagem `/projetos/` por padrão) |
| `home_size` | Tamanho no grid (ex.: `1x1`, `2x2`) — consumido pelo JS de masonry |
| `home_col` / `home_row` | Coordenadas fixas na grelha da Home (inteiros, 0-indexadas). Quando ambas presentes, o site renderiza em layout livre. Se `null`, o site cai no Packery como fallback |
| `youtube_url` / `pixieset_url` | Opcionais na página de detalhe |

**Convenção de nome do arquivo:** `YYMMDD-NomeProjeto-Cliente.md` (sem acentos no nome do arquivo); caminhos de mídia seguem o padrão descrito no `README.md`.

### 2.8 `projects.json`

Arquivo Jekyll com `layout: null` e `permalink: /projects.json`. Gera um **array JSON** com um objeto por projeto (título, URLs, flags de home, ordem, `search_blob` para busca, etc.), usado pela página `/projetos/`.

---

## 3. CMS e painel administrativo (`/admin/`)

O painel em **`/admin/`** é um **Visual Portfolio CMS** customizado — uma SPA (single-page application) que simula o grid masonry da home e permite **arrastar para reordenar**, **clicar para editar** todos os campos e **criar/excluir** projetos. O backend é o **Cloudflare Worker** (`cms.reversofilmes.com.br`). Login usa **GitHub OAuth** via redirect completo ao Worker (que troca o código com GitHub e emite JWT em cookie httpOnly).

**Stack do painel (zero build step, CDN):**
- **Draggabilly 3.0.0** — drag-and-drop dos cartões (sem packing; posições 2D livres)
- **Packery 2.1.2** — *somente fallback* no site público quando algum projeto ainda não tem `home_col`/`home_row`; o admin já não usa Packery
- **Alpine.js 3.14.9** — reatividade para formulários e estado
- **EasyMDE 2.18.0** — editor Markdown para o campo `body`
- **Cloudflare Worker API** — CRUD, upload de mídia, autenticação, deploy hook

**Estrutura de arquivos do painel:**
```
admin/
  index.html                   ← SPA principal
  config.yml                   ← referência / fallback Sveltia
  assets/
    css/admin.css              ← tema escuro, layout, componentes
    js/
      cf-api.js                ← cliente da Worker API (credentials: include, CSRF headers)
      auth.js                  ← autenticação (redirect OAuth, check session, logout)
      media-upload.js          ← validação client-side de mídia
      grid-manager.js          ← Packery + Draggabilly, lógica de reorder
      admin-app.js             ← orquestrador Alpine.js (editor, CRUD, estado)
```

**Funcionalidades principais:**
- **Grid visual 2D livre** na Home: cada cartão tem posição fixa `(home_col, home_row)` + tamanho `home_size` (1×1, 1×2, 2×1, 2×2). Nada é reempacotado automaticamente.
- **Swap no drop**: soltar um cartão em cima de outro troca as posições dos dois; outros não se movem.
- **Aba "Todos"**: grid sequencial 1×1 ordenado por `order`; drag também funciona como swap.
- **Editor lateral**: todos os campos do front matter, upload de mídia, editor Markdown.
- **Modelo "rascunho → Publicar"**: alterações ficam em memória no browser. Drag só move localmente; "Salvar Layout" inclui na publicação. "Publicar" faz todos os PATCH/POST/reorder em sequência e um `POST /api/deploy`.
- **Auto-pack inicial**: projetos novos ou com `home_col/home_row` nulos recebem uma posição via first-fit; a atribuição entra como rascunho pendente e vira persistente no próximo "Publicar".
- **Criar / Excluir** projetos com cleanup de mídia em R2.
- **Optimistic locking**: campo `version` em cada projeto; 409 Conflict se editado por outro utilizador.
- **Deploy hook**: disparado **uma só vez** por "Publicar" (debounce global de 5 min continua a proteger o Netlify).

### 3.1 Fluxo de dados

O admin SPA consome a Worker API. Edições e uploads vão para D1 e R2 (sem tocar no repositório Git). Um deploy hook dispara rebuild no Netlify, que executa `scripts/fetch-projects.mjs` para buscar dados atualizados do Worker e gerar `_data/projects.json` para o Jekyll.

**Fonte de verdade:** em operação normal, o conteúdo editável do portfólio está em **D1** + mídia em **R2**; o site público no build usa só o export (`_data/projects.json`). Os ficheiros `_projects/*.md` no Git servem de **arquivo / rollback** até descontinuar explicitamente o modelo Markdown; import ou reidratação pode usar `scripts/import-projects.mjs`.

**`_projects/*.md` e D1 não sincronizam sozinhos.** Cada alteração no Git nos `.md` **não** atualiza a base D1. Para alinhar o admin (que lê sempre o Worker/D1), execute `node scripts/import-projects.mjs` com `WORKER_URL` e `AUTH_TOKEN` (cookie `__session` após login), ou crie/edite só pelo admin. No Jekyll, se `_data/projects.json` existir mas for um array **vazio** `[]`, o filtro Liquid `default` **não** substitui por `site.projects`; os includes usam fallback explícito (`size == 0` → coleção `_projects/`). **Descompasso:** se o export no Netlify falhar e `fetch-projects.mjs` reutilizar **cache** antigo, o site pode listar projetos antigos com o D1 já vazio ou diferente — o admin reflete só o D1. Nesse caso limpe o cache de build no Netlify e garanta `CF_BUILD_TOKEN` + export 200.

#### Sincronizar `_data/projects.json` localmente (build alinhado ao D1)

O Jekyll **não** lê o D1 em tempo real: usa **`_data/projects.json`**, gerado por `scripts/fetch-projects.mjs` no mesmo fluxo que o Netlify (`WORKER_EXPORT_URL` + `Authorization: Bearer` com **`CF_BUILD_TOKEN`** — o token de **build/export**, não o cookie de sessão do admin).

No PowerShell, na raiz do site:

```powershell
$env:WORKER_EXPORT_URL = "https://<seu-worker>.workers.dev/api/projects/export"
$env:CF_BUILD_TOKEN = "<BUILD_TOKEN configurado no Worker / Netlify / .dev.vars>"
node scripts/fetch-projects.mjs
bundle exec jekyll serve
```

Ajuste `WORKER_EXPORT_URL` ao endpoint real `/api/projects/export` (como em `netlify.toml`).

#### Miniaturas YouTube → R2 e export

- O Worker pode **baixar** uma JPEG do YouTube (`hqdefault` → … → `maxresdefault`) e gravar no **R2**, guardando no D1 só a **chave** (`projects/<slug>/thumb-yt-<videoId>.jpg`). O site e o export passam a usar URLs sob **`MEDIA_BASE_URL`** (ex.: `media.reversofilmes.com.br`), não `img.youtube.com`.
- Isto corre **ao criar** projeto (sem thumbnail manual) com `youtube_url`, **ou ao editar/guardar** no admin quando a thumbnail ainda aponta para o CDN do YouTube.
- **Projetos antigos** em que o D1 ainda tem URL do YouTube **não mudam** só com deploy: é preciso **guardar cada um no admin** ou correr a migração em massa (mesmo token de build):

```powershell
$env:WORKER_API_BASE = "https://<seu-worker>.workers.dev"
$env:CF_BUILD_TOKEN = "<BUILD_TOKEN>"
node scripts/backfill-youtube-thumbnails.mjs
```

Ou `curl -X POST -H "Authorization: Bearer <TOKEN>" https://<worker>/api/projects/backfill-youtube-thumbnails`

Resposta JSON: `candidates`, `ingested`, `failed` (slugs em que o download ao YouTube falhou — bloqueio de rede, vídeo sem miniatura, etc.). Depois: `fetch-projects.mjs` + deploy do site (ou build local).

**Domínio público do R2 (`MEDIA_BASE_URL`):** o export devolve URLs absolutas (ex.: `https://media.reversofilmes.com.br/projects/.../thumb-yt-....jpg`). No Jekyll, **`relative_url` não deve ser aplicado a essas URLs** — o include `projects-grid.html` usa o mesmo critério que `project.html`: se o caminho contém `://`, usa-se a string tal qual; caso contrário, `relative_url` para caminhos do próprio site. Se no browser aparecer `net::ERR_NAME_NOT_RESOLVED` ao carregar imagens desse host, o problema é **DNS / domínio customizado do R2** (no painel Cloudflare: R2 → bucket → **Custom Domains**, registo `media` em **DNS** com proxy laranja). Confirme com `nslookup media.reversofilmes.com.br` ou abra uma URL de thumbnail diretamente no navegador.

**Demo / fork sem o domínio do cliente na Cloudflare:** o Netlify só serve o site estático; **não** substitui URLs de mídia. O Worker expõe **`GET /media/<chave-R2>`** (sem login) — a chave continua a ser `projects/<slug>/...` como no bucket. Defina no **Dashboard do Worker** (ou `wrangler secret`/vars) **`MEDIA_BASE_URL`** = `https://<seu-worker>.<subconta>.workers.dev/media` (sem barra no fim). Volte a correr o export (`fetch-projects`) para o `_data/projects.json` refletir essas URLs. Em produção com `media.reversofilmes.com.br`, volte `MEDIA_BASE_URL` para esse domínio. O `netlify.toml` inclui o host `workers.dev` do projeto no CSP do admin para pré-visualizar thumbnails.

**Nota:** a JPEG que o YouTube serve para Shorts pode continuar a ser uma composição 16:9 (faixa central + laterais). Mudar o armazenamento para R2 **não** altera o desenho do ficheiro; só muda o host. O CSS da home ajusta `object-fit` / `object-position` por `data-size` (`home_size`) para encaixar melhor em 1×1, 2×1 e 2×2.

#### Encaixe de mídia nos blocos da masonry (home)

- **`assets/css/main.css`:** `.project-thumbnail` e `.project-hover-video` usam `object-fit: cover`; para tamanhos **1×1, 2×1 e 2×2** usa-se `object-position: center 22%` para favorecer a zona central típica de capas verticais em moldura larga; **1×2** mantém `center`.
- **Texto:** título e cliente com `-webkit-line-clamp` (mais restritivo em **1×1**).

#### Miniaturas e hover a partir do YouTube (1.º frame + 5 s de vídeo)

As JPEG do CDN do YouTube (`img.youtube.com`) para Shorts costumam ser **composições 16:9** (faixa 9:16 ao centro + laterais), não um recorte limpo do vídeo. Para **poster = 1.º frame real** e **hover = primeiros 5 s** (sem a arte do YouTube), o processamento tem de usar **yt-dlp + FFmpeg** fora do Worker.

**Curto prazo (máquina local / demo):** script `scripts/ingest-youtube-media.mjs`.

1. **Pré-requisitos:** [yt-dlp](https://github.com/yt-dlp/yt-dlp) e [FFmpeg](https://ffmpeg.org/) no `PATH`.
2. **Uma vez:** `cd scripts && npm install` (instala `@aws-sdk/client-s3` para upload compatível com a API S3 do R2).
3. **Credenciais R2:** no painel Cloudflare → R2 → **Manage R2 API Tokens** — criar token com permissão de leitura/escrita em objetos; obter também o **Account ID** (`R2_ACCOUNT_ID`).
4. **Variáveis de ambiente** (PowerShell exemplo):

```powershell
$env:R2_ACCOUNT_ID = "<Account ID>"
$env:R2_ACCESS_KEY_ID = "<Access Key ID>"
$env:R2_SECRET_ACCESS_KEY = "<Secret Access Key>"
$env:R2_BUCKET = "reverso-media"
$env:WORKER_API_BASE = "https://<worker>.<subconta>.workers.dev"
$env:CF_BUILD_TOKEN = "<BUILD_TOKEN ou JWT read:export>"
```

5. **Deploy do Worker** com a rota `GET /api/projects/youtube-manifest` (lista `slug` + `youtube_url` para todos os projetos com URL; auth: mesmo token de build).

6. **Executar** (na raiz do repositório):

**Um projeto:**

```powershell
node scripts/ingest-youtube-media.mjs "<slug-do-projeto-no-D1>" "https://youtube.com/shorts/VIDEO_ID"
```

**Todos os projetos que têm `youtube_url` no D1** (processa em sequência; pausa configurável entre cada um):

```powershell
$env:INGEST_DELAY_MS = "4000"
node scripts/ingest-youtube-media.mjs --all
```

O script obtém a lista com `GET …/api/projects/youtube-manifest` (`Authorization: Bearer` + `CF_BUILD_TOKEN`). Em caso de falha num projeto, regista o erro e continua nos seguintes; no fim mostra resumo (OK / falhas). `INGEST_DELAY_MS` (ms, default 4000) reduz picos contra o YouTube; use `0` para desativar a pausa (não recomendado em lotes grandes).

O fluxo por projeto: descarrega o melhor MP4 disponível com yt-dlp → FFmpeg extrai **1 frame** (`yt-poster.jpg`) e **5 s sem áudio** (`hover-5s.mp4`) → envia para o R2 em `projects/<slug>/` → chama **`POST /api/projects/media-keys`** no Worker para atualizar `thumbnail` e `hover_preview` no D1 e incrementar `version`.

Depois: `node scripts/fetch-projects.mjs` + deploy do site (ou build local).

**Ficheiros gerados (chaves R2):**

| Campo | Chave |
|-------|--------|
| `thumbnail` | `projects/<slug>/yt-poster.jpg` |
| `hover_preview` | `projects/<slug>/hover-5s.mp4` |

**Nota legal / operacional:** usar apenas para vídeos em que o cliente tenha direitos; respeitar os termos do YouTube e políticas da conta.

---

**A) Pipeline assíncrono com FFmpeg + yt-dlp (recomendado para controlo total em produção)**

| | |
|--|--|
| **Onde correr** | VM barata (Hetzner, etc.), **GitHub Actions** (`ubuntu-latest` com FFmpeg + yt-dlp), Railway/Render job, Cloud Run, etc. |
| **Fluxo típico** | Input: `youtube_url` + `slug`. Descarregar stream com yt-dlp. **Thumbnail:** `ffmpeg -ss 0 -i … -vframes 1 -q:v 85` → R2 `projects/{slug}/yt-poster.jpg`. **Hover:** `ffmpeg -t 5 -an -c:v libx264 -preset fast -crf 23 -movflags +faststart` → `projects/{slug}/hover-5s.mp4`. Notificar D1 (mesmo endpoint `POST /api/projects/media-keys` ou fila + Worker). |
| **Prós** | Qualidade real (1.º frame real, clip curto otimizado), repetível em CI. |
| **Contras** | Infra extra, filas/retries, timeouts em jobs longos; GitHub Actions tem limite de minutos. |
| **Encaixe** | R2 + Worker já existem; falta agendar o job (webhook no push, cron, ou botão no admin numa fase seguinte). |

---

#### Evolução adicional: recorte fino e variantes

Para **recorte** automático ao centro 9:16, variantes por `home_size`, ou **WebP** gerado em lote, o fluxo pode estender-se com:

- **Cloudflare Images** (resize/crop via URL) — custo / limites do plano; ou
- **Worker + WASM** (ex. Squoosh) só para JPEG, ou fila dedicada com FFmpeg noutro serviço.

São passos opcionais quando **um par** poster + hover no R2 + `object-fit: cover` no site não forem suficientes.

### 3.2 Produção: OAuth GitHub via Worker

1. **GitHub:** criar um **OAuth App** com **Callback URL** `https://cms.reversofilmes.com.br/api/auth/github/callback` e **Homepage URL** `https://admin.reversofilmes.com.br`.
2. **Worker secrets:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` (via `wrangler secret`).
3. O admin redireciona para `https://cms.reversofilmes.com.br/api/auth/github`; o Worker gera `state`, redireciona para GitHub, recebe callback, verifica allowlist, emite JWT em cookie httpOnly, redireciona para o admin.

**Quem publica:** cada pessoa precisa de **conta GitHub própria** (recomenda-se **2FA**) e ter o `github_id` inserido na tabela `admin_allowlist` do D1.

### 3.3 Staging em fork (Netlify `*.netlify.app` + Worker `*.workers.dev`)

O fluxo **não** usa mais `https://api.netlify.com/auth/done` (isso era do CMS antigo via proxy Netlify). Com o Worker:

1. **GitHub → Settings → Developer settings → OAuth Apps**  
   - **Homepage URL:** pode ser o site de staging, ex. `https://classy-nougat-5d062d.netlify.app`  
   - **Authorization callback URL:** tem de ser **no Worker**, no formato  
     `https://<nome-do-worker>.<subconta>.workers.dev/api/auth/github/callback`  
     (o URL exato aparece no dashboard da Cloudflare após `wrangler deploy`, em Workers → o seu worker → domínio `*.workers.dev`).  
   - Um OAuth App clássico só admite **uma** callback URL. Se ainda precisar do fluxo antigo Netlify noutro projeto, crie um **OAuth App separado** só para este CMS.

2. **Variáveis do Worker** (dashboard Cloudflare ou `wrangler.toml` / env de deploy):  
   - `ALLOWED_ORIGINS`: inclua `https://classy-nougat-5d062d.netlify.app` (e o URL do admin se for diferente).  
   - `ADMIN_ORIGIN`: `https://classy-nougat-5d062d.netlify.app` (para onde o utilizador volta após login).  
   - **`COOKIE_DOMAIN`:** deixe **vazio** (remova o valor ou use string vazia). Com admin em `netlify.app` e API em `workers.dev`, o cookie de sessão tem de ser `SameSite=None; Secure` no host do Worker (o código faz isso automaticamente quando `COOKIE_DOMAIN` está vazio).

3. **`admin/index.html`:** ajuste a meta  
   `<meta name="reverso-cms-api" content="https://…workers.dev" />`  
   para o URL **exato** do Worker (sem barra no fim).

4. **`netlify.toml` — CSP em `/admin/*`:** em `connect-src` tem de constar o **mesmo** URL do Worker (ex. `https://reverso-cms-api.xxx.workers.dev`), senão o browser bloqueia o `fetch`. Copie o valor da meta `reverso-cms-api`.

5. **Netlify → Environment variables:** `WORKER_EXPORT_URL` deve apontar para `https://…workers.dev/api/projects/export` (mesmo host do Worker) enquanto não usar `cms.reversofilmes.com.br`.

Em produção no domínio do cliente, volte a: callback `https://cms…/api/auth/github/callback`, `COOKIE_DOMAIN=.reversofilmes.com.br`, `ADMIN_ORIGIN` e `ALLOWED_ORIGINS` oficiais, meta e CSP com `https://cms.reversofilmes.com.br`.

### 3.4 Desenvolvimento local (`wrangler dev`)

0. **Jekyll:** na **raiz do repositório** (pasta que contém `_config.yml` e `Gemfile`), não dentro de `cf-worker/`. Ex.: `cd …/site` e `bundle exec jekyll serve`. Se correr o comando estando em `cf-worker/`, o servidor mostra listagem de ficheiros do Worker em vez do site.
1. `cd cf-worker && npx wrangler dev` — Worker em `http://127.0.0.1:8787`. Para usar **D1/R2 remotos** na conta Cloudflare: `npm run dev:remote`.
2. **URL da API no admin:** controlada por `reverso_cms_api` em `_config.yml`. Para apontar o admin local para o Worker local, crie `_config.local.yml` (gitignored) com `reverso_cms_api: "http://127.0.0.1:8787"` e rode `bundle exec jekyll serve --config _config.yml,_config.local.yml`. Sem ficheiro local, o build usa o URL em `_config.yml` (ex. `*.workers.dev`).
3. **CORS e cookie em `wrangler dev`:** o `wrangler.toml` traz `COOKIE_DOMAIN` de produção. Com o admin em `http://127.0.0.1:4000` e a API em `:8787`, em `.dev.vars` defina `COOKIE_DOMAIN=` (vazio), `ADMIN_ORIGIN=http://127.0.0.1:4000` e `DEV_ORIGINS=http://127.0.0.1:4000,http://localhost:4000` (ver `cf-worker/.dev.vars.example`).
4. OAuth no GitHub: um OAuth App clássico só tem **uma** callback. Para login local, ou crie um **OAuth App separado** com callback `http://127.0.0.1:8787/api/auth/github/callback`, ou use só o deploy `*.workers.dev` até existir custom domain.

### 3.5 Validação de mídia

O Worker valida uploads: tipos permitidos (jpeg, png, webp, mp4, webm), tamanho máximo 25MB, path sanitization (sem `..` ou caracteres especiais). Keys em R2 são normalizados: `projects/{slug}/{tipo}-{hash8}.{ext}`. O painel também faz validação client-side antes do upload.

### 3.6 Segurança do admin

- **`/admin/`** é URL pública; a proteção é o **login GitHub OAuth** + **allowlist de github_id** no D1.
- **Sessão**: JWT em cookie httpOnly/Secure/SameSite=Lax; nunca em localStorage.
- **CSRF**: todas as mutações exigem header `X-Requested-With: fetch`.
- **CSP**: configurado via `netlify.toml` para `/admin/*`.
- **CDN:** o `admin/index.html` pina versões fixas de todas as libs para reduzir risco de supply chain.

### 3.7 Limitações

- **Upload:** limite **25MB** por arquivo; vídeos de hover devem ser curtos e comprimidos.
- **Slug:** novos projetos devem usar o padrão `MMDDYYYY-titulo-cliente` em **minúsculas**; o Worker valida criação com `^[a-z0-9][a-z0-9-]{0,127}$`. Slugs de projetos **já importados** (ex. maiúsculas no ficheiro Markdown) continuam aceites em URLs e uploads via regra mais permissiva em `cf-worker/src/utils/slug.js` (`SLUG_PATH_RE`).
- **Edição concorrente:** optimistic locking via campo `version` em PATCH — 409 Conflict se versão desatualizada. O **reorder** em lote (`POST /api/projects/reorder`) não usa `version`; dois editores a reordenar em simultâneo podem sobrepor ordens (aceite para MVP).
- **Jekyll na pasta errada:** se correr `jekyll build`/`serve` dentro de `cf-worker/`, pode aparecer `cf-worker/_site` — apague essa pasta localmente (está coberta por `.gitignore` como `_site`); o site correto gera-se na raiz do repo.

### 3.8 O que o painel cobre

Tabela **projects** em D1, mídia em R2 (`projects/{slug}/`), campos alinhados ao modelo de dados (incluindo corpo Markdown), **reordenação visual** da home e portfólio, toggle de publicação. Layouts, CSS, JS e `_config.yml` continuam no Git pela equipe técnica.

---

## 4. Backend Cloudflare — Arquitetura

> **Status:** implementado — código em `cf-worker/`. Plano original em `.cursor/plans/backend_cms_migration_45b7ab64.plan.md`.

### 4.1 Visão geral

O backend migra do modelo "GitHub API direto" para **Cloudflare Workers** como API centralizada. O site público continua no **Netlify** (build Jekyll). O admin consome a API do Worker em vez de escrever diretamente no repositório Git.

```
Visitante → www.reversofilmes.com.br → Netlify (site estático Jekyll)
Admin     → admin.reversofilmes.com.br → Netlify (SPA) → cms.reversofilmes.com.br (Worker API)
Mídia     → media.reversofilmes.com.br → R2 (bucket público)
Build     → Netlify build → fetch cms.reversofilmes.com.br/api/projects/export → _data/projects.json → Jekyll
```

### 4.2 Decisões arquiteturais

**DA-1 — Domínios:**

| Subdomínio | Função | Destino |
|---|---|---|
| `cms.reversofilmes.com.br` | API Worker (CMS) | Cloudflare Worker Custom Domain |
| `admin.reversofilmes.com.br` | Admin SPA | Netlify (CNAME) |
| `media.reversofilmes.com.br` | Mídia pública R2 | R2 public bucket custom domain |
| `www.reversofilmes.com.br` / `@` | Site público | Netlify (sem alteração) |

Admin e API sob o mesmo domínio registrável (`.reversofilmes.com.br`) permite cookies `SameSite=Lax` sem restrições de third-party.

**DA-2 — Sessões: JWT + revogação**

- JWT assinado com HMAC-SHA256 (`JWT_SECRET` no Worker), claims: `sub` (github_id), `jti` (UUID v4), `exp` (8 horas).
- Cookie `__session`: `httpOnly; Secure; SameSite=Lax; Domain=.reversofilmes.com.br; Path=/; Max-Age=28800`.
- Tabela `revoked_sessions(jti, revoked_at)` em D1 para logout/invalidação. Limpeza automática (Cron Trigger diário, entradas > 30 dias).

**DA-3 — URLs de mídia: path relativo + base URL configurável**

- D1 guarda apenas o path relativo: `projects/{slug}/thumbnail-{hash8}.jpg`.
- Worker de export monta URL completa: `{MEDIA_BASE_URL}/{path}`.
- Mudança de bucket = alterar `MEDIA_BASE_URL` no Worker; zero migração no D1.

### 4.3 Modelo de dados (D1)

Schema em `cf-worker/migrations/0001_initial.sql`. Tabelas:

| Tabela | Função |
|---|---|
| `projects` | Conteúdo de portfolio (slug, título, mídia, metadados, `version` para optimistic locking) |
| `admin_allowlist` | GitHub IDs autorizados a usar o CMS |
| `revoked_sessions` | JTIs de sessões revogadas (logout) |
| `audit_log` | Registro de todas as mutações (quem, o quê, quando) |
| `login_attempts` | Rate limiting de login por IP |
| `deploy_log` | Debounce do deploy hook Netlify |

### 4.4 Componentes do Worker (API)

| Rota | Método | Auth | Função |
|---|---|---|---|
| `/health` | GET | — | Health check (D1 `SELECT 1`) |
| `/api/projects/export` | GET | BUILD_TOKEN | Export publicados (para build Netlify) |
| `/api/projects` | GET | JWT | Listar todos (admin) |
| `/api/projects/:slug` | GET/POST/PATCH/DELETE | JWT | CRUD com optimistic locking |
| `/api/upload` | POST | JWT | Upload mídia → R2 |
| `/api/auth/github` | GET | — | Iniciar OAuth (gerar state) |
| `/api/auth/github/callback` | GET | — | Callback OAuth (validar state, criar JWT) |
| `/api/auth/logout` | POST | JWT | Revogar sessão (inserir jti) |
| `/api/deploy` | POST | JWT | Disparar deploy hook (com debounce 5 min) |

**Middleware stack (resumo):** CORS → (rate limit em rotas de auth) → JWT → revogação + allowlist em todas as rotas com sessão → `GET` públicos autenticados → CSRF nas mutações → validação → handler → audit log (async via `waitUntil`).

---

## 5. Segurança

### 5.1 Camadas de proteção

1. **Borda Cloudflare** (hostname `cms.*`): SSL Full, Bot Fight Mode, Rate Limiting Rules (5 req/min/IP em auth e upload), WAF custom rules.
2. **Worker**: CSRF via header custom, OAuth state anti-CSRF, JWT com exp/jti, allowlist e revogação também em `GET` autenticados, validação de input por rota (slug novo: `^[a-z0-9][a-z0-9-]{0,127}$`; paths legados: `SLUG_PATH_RE` em `utils/slug.js`), optimistic locking em updates.
3. **R2**: uploads só via Worker autenticado, keys normalizados (`projects/{slug}/{tipo}-{hash8}.{ext}`), sem input direto do utilizador, cleanup ao eliminar projeto.
4. **D1**: só via binding Worker, queries parametrizadas, audit log.
5. **CI (Netlify build)**: BUILD_TOKEN (JWT com scope `read:export`, exp 1 ano), nunca no Git, retry + fallback no fetch script.
6. **Admin SPA**: CSP via `netlify.toml`, security headers globais (X-Frame-Options, X-Content-Type-Options, Referrer-Policy), sem localStorage para tokens.

### 5.2 Checklist de segurança (antes de produção)

- [ ] CSRF: header `X-Requested-With: fetch` validado em mutações
- [ ] OAuth: parâmetro `state` gerado + validado no callback
- [ ] Sessão: JWT com `exp` 8h, `jti`, HMAC-SHA256; cookie httpOnly/Secure/SameSite=Lax
- [ ] Logout: revoga `jti` em `revoked_sessions`
- [ ] D1: queries parametrizadas; audit_log ativo
- [ ] R2: uploads autenticados; keys normalizados; bucket não listável; cleanup
- [ ] BUILD_TOKEN: JWT com exp e scope; só env var Netlify
- [ ] Allowlist: populada antes de ativar OAuth
- [ ] CORS: origens explícitas; nunca `*` com credenciais
- [ ] Input: validação de schema em todas as rotas
- [ ] Uploads: max 25MB + MIME allowlist + path sanitization
- [ ] CSP: configurado no admin
- [ ] Deploy hook: debounce 5 min no Worker
- [ ] Rate limiting: borda CF + D1 em auth
- [ ] Optimistic locking: campo `version` + 409 Conflict
- [ ] Monitoring: /health, alertas CF, backups semanais em R2

---

## 6. Variáveis de ambiente e secrets

### 6.1 Worker (Cloudflare — via `wrangler secret` ou dashboard)

| Variável | Descrição |
|---|---|
| `GITHUB_CLIENT_ID` | Client ID do GitHub OAuth App |
| `GITHUB_CLIENT_SECRET` | Client Secret do GitHub OAuth App |
| `JWT_SECRET` | Chave HMAC-SHA256 para assinar JWTs (min 32 bytes) |
| `NETLIFY_DEPLOY_HOOK_URL` | URL do deploy hook Netlify (POST para disparar build) |
| `BUILD_TOKEN` | JWT pré-assinado com scope `read:export` (para CI ler export) |
| `MEDIA_BASE_URL` | URL base para montar URLs de mídia (ex.: `https://media.reversofilmes.com.br`) |
| `SKIP_AUTH_RATE_LIMIT` | Opcional: defina `1` em `.dev.vars` local quando `CF-Connecting-IP` for `unknown` (ex. `wrangler dev`) para não acumular tentativas de login sob o mesmo IP sintético. |

### 6.2 Netlify (painel Netlify — nunca no repositório)

| Variável | Descrição |
|---|---|
| `WORKER_EXPORT_URL` | URL do endpoint de export (ex.: `https://cms.reversofilmes.com.br/api/projects/export`) |
| `CF_BUILD_TOKEN` | Mesmo valor de `BUILD_TOKEN` do Worker |

### 6.3 Rotação de secrets

- **JWT_SECRET:** gerar novo; todas as sessões existentes ficam inválidas (logout forçado). Recriar BUILD_TOKEN com novo secret.
- **BUILD_TOKEN:** gerar novo JWT com o JWT_SECRET atual; atualizar env var no Worker e Netlify.
- **GITHUB_CLIENT_SECRET:** regenerar no GitHub; atualizar no Worker.
- **NETLIFY_DEPLOY_HOOK_URL:** recriar no Netlify; atualizar no Worker.

---

## 7. Procedimento de rollback (backend → Git-based)

Se a migração para Cloudflare falhar ou precisar ser revertida:

### 7.1 Pré-condição

Os arquivos `_projects/*.md` devem estar preservados no repositório (mantidos durante o período de coexistência de 2 semanas).

### 7.2 Passos

1. **`netlify.toml`:** reverter o build command para `bundle exec jekyll build` (remover `node scripts/fetch-projects.mjs &&`).
2. **Templates Liquid:** reverter referências de `site.data.projects` para `site.projects` (coleção Jekyll original).
3. **Admin:** o fluxo antigo “GitHub API direto no browser” (`github-api.js` / `github-auth.js`) foi **removido** do repositório em favor de `cf-api.js` + `auth.js` (Worker). Para rollback desse painel, recupere os ficheiros antigos do histórico Git e restaure as tags `<script>` em `admin/index.html` conforme versão anterior.
4. **Push e rebuild:** o Netlify volta a usar a coleção `_projects/` diretamente.
5. **DNS:** remover registos `cms`, `admin`, `media` se desejado (opcional — não afetam o site).

### 7.3 Dados

Se houver projetos criados/editados apenas no D1 (não sincronizados para `_projects/`), exportar do D1 antes do rollback:

```bash
# Exportar do Worker
curl -H "Authorization: Bearer $BUILD_TOKEN" \
  https://cms.reversofilmes.com.br/api/projects/export > projects-backup.json

# Converter para .md (script a ser escrito se necessário)
```

---

## 8. Alternativa em stand-by: Supabase

**Não faz parte do plano de execução atual.** Documentado como referência para decisão futura.

**Supabase** oferece: Postgres com RLS, Storage para mídia, Auth GitHub nativo, Edge Functions ou webhooks. O padrão "snapshot no build + deploy hook Netlify" mantém-se análogo ao do Cloudflare.

**Quando considerar:** se a equipa preferir menos código de autorização customizado, aceitar o modelo de quotas do plano free (pausa após inatividade) ou migrar para plano pago, e quiser interface SQL completa para queries.

**Migração Cloudflare → Supabase:** exportar tabela `projects` de D1, importar em Postgres; migrar mídia de R2 para Supabase Storage; ajustar Worker para Edge Function; manter deploy hook e fetch script com URLs atualizadas.

---

## 9. Referências rápidas

- Jekyll: https://jekyllrb.com/docs/
- Coleções: https://jekyllrb.com/docs/collections/
- Sveltia CMS: https://github.com/sveltia/sveltia-cms
- Decap CMS (alternativa): https://decapcms.org/docs/
- Tema Minima: https://github.com/jekyll/minima
- Packery (masonry): https://packery.metafizzy.co/
- Cloudflare Workers: https://developers.cloudflare.com/workers/
- Cloudflare D1: https://developers.cloudflare.com/d1/
- Cloudflare R2: https://developers.cloudflare.com/r2/
- Wrangler CLI: https://developers.cloudflare.com/workers/wrangler/
- Supabase: https://supabase.com/docs

---

## 10. Setup do backend (primeira vez)

### 10.1 Cloudflare

1. Após `wrangler d1 create reverso-db`, copie o **database id** para `cf-worker/wrangler.toml` (substitua `REPLACE_WITH_D1_DATABASE_ID`).
2. Para desenvolvimento local: `cp cf-worker/.dev.vars.example cf-worker/.dev.vars` e preencha os valores (o Wrangler carrega `.dev.vars` automaticamente em `wrangler dev`).

```bash
cd cf-worker
npm install
wrangler login

# Criar D1 e R2 — atualizar database_id em wrangler.toml
wrangler d1 create reverso-db
wrangler r2 bucket create reverso-media

# Aplicar schema
wrangler d1 migrations apply reverso-db --remote

# Secrets
wrangler secret put GITHUB_CLIENT_ID
wrangler secret put GITHUB_CLIENT_SECRET
wrangler secret put JWT_SECRET
wrangler secret put NETLIFY_DEPLOY_HOOK_URL
wrangler secret put BUILD_TOKEN
wrangler secret put MEDIA_BASE_URL

# Popular allowlist
wrangler d1 execute reverso-db --remote \
  --command "INSERT INTO admin_allowlist (github_id, name) VALUES ('YOUR_GITHUB_ID', 'Admin Name')"

# Deploy
wrangler deploy
```

### 10.2 DNS

Criar registos para `cms`, `admin`, `media` sob `reversofilmes.com.br` (ver secção 4.2 DA-1).

### 10.3 Netlify

**Deploy hook (`NETLIFY_DEPLOY_HOOK_URL`):**

1. Netlify → o seu site (ex. staging) → **Configuration** → **Build & deploy** → **Build hooks** → **Add build hook**.
2. Dê um nome (ex. `cms-rebuild`) e escolha a branch a construir.
3. Copie o URL gerado (começa por `https://api.netlify.com/build_hooks/...`). Esse é o valor de `NETLIFY_DEPLOY_HOOK_URL` no Worker (`wrangler secret put` ou `.dev.vars`). Um `POST` nesse URL dispara um build; o Worker já faz debounce (máx. 1 por 5 min).

**Variáveis de ambiente do site (build):**

- `CF_BUILD_TOKEN` — o mesmo JWT gerado com `cf-worker/scripts/generate-build-token.mjs` (ou o valor guardado em `BUILD_TOKEN`).
- `WORKER_EXPORT_URL` — em produção: `https://cms.reversofilmes.com.br/api/projects/export`; em staging com Worker em `*.workers.dev`: `https://SEU-WORKER.workers.dev/api/projects/export`.

**Gerar de novo o `BUILD_TOKEN` (atalho `npm run token:build`):**

Na pasta **`cf-worker`**, o `package.json` define o script `token:build`, que corre o mesmo gerador. O **segredo tem de estar na variável de ambiente** `JWT_SECRET` **no momento em que o npm corre** (não fica guardado no `package.json`).

Exemplos (Git Bash):

```bash
cd cf-worker
export JWT_SECRET="o_mesmo_hex_que_definiu_para_o_worker"
npm run token:build
```

PowerShell:

```powershell
cd cf-worker
$env:JWT_SECRET="o_mesmo_hex_que_definiu_para_o_worker"
npm run token:build
```

O comando imprime uma linha longa (JWT): use em `BUILD_TOKEN` / `CF_BUILD_TOKEN` e em `wrangler secret put BUILD_TOKEN`.

### 10.3b Atualizar schema para o layout 2D livre (migration 0003)

A partir da versão com layout 2D livre, a tabela `projects` tem as colunas `home_col` e `home_row` (INTEGER, `NULL` quando a posição ainda não foi atribuída). A migration é `cf-worker/migrations/0003_home_grid_position.sql`. Aplicação:

```bash
cd cf-worker

# Produção
wrangler d1 migrations apply reverso-db --remote

# Desenvolvimento local
wrangler d1 migrations apply reverso-db --local
```

**Comportamento na primeira utilização após a migração:**

- Projetos existentes ficam com `home_col` / `home_row` = `NULL`. O admin executa um *first-fit packing* inicial (equivalente ao Packery antigo) no render, marca essas posições como **rascunho pendente** e espera um `Publicar` para gravá-las.
- O site público (`assets/js/masonry-init.js`) continua a cair no Packery enquanto **algum** item não tiver ambos os campos preenchidos; quando todos estiverem, passa a usar o layout absoluto 1-para-1 com o admin.
- Depois do primeiro `Publicar`, não há mais reempacotamento automático: cada cartão fica onde o utilizador o soltou.

### 10.4 Migração de dados

```bash
# Dry run
node scripts/import-projects.mjs --dry-run

# Executar (com Worker remoto)
WORKER_URL=https://cms.reversofilmes.com.br AUTH_TOKEN=<jwt> node scripts/import-projects.mjs

# Planilha (Google Sheets → Transferir → .tsv UTF-8 recomendado; .csv ainda suportado)
# Por omissão usa `_projects/projects_sheet.tsv`.
SHEET_PATH=_projects/projects_sheet.tsv WORKER_URL=https://…workers.dev AUTH_TOKEN=<jwt> node scripts/import-projects-sheet.mjs
node scripts/import-projects-sheet.mjs --dry-run
```

**`AUTH_TOKEN` não vem de `.dev.vars`.** São coisas diferentes: `.dev.vars` / secrets do Worker são para o servidor (`JWT_SECRET`, OAuth, `BUILD_TOKEN`, etc.). O import precisa do **JWT da tua sessão** depois de login no admin (o mesmo valor gravado no cookie HttpOnly `__session`). Como é HttpOnly, o JavaScript da página não o lê; em DevTools use **Rede** → um pedido `fetch` ao host do Worker (ex. `cms.reversofilmes.com.br`) → cabeçalhos do pedido → copie só o token após `__session=`. Em **Cookies**, filtre pelo **mesmo host do Worker** (não só o domínio do site estático no Netlify). Os scripts enviam `Authorization: Bearer` e `Cookie: __session` com esse JWT.

Colunas suportadas: ver comentário no topo de `scripts/import-projects-sheet.mjs`.

### 10.5 Testes locais

```bash
# Terminal 1: Worker
cd cf-worker && wrangler dev

# Terminal 2: Fetch + Jekyll
WORKER_EXPORT_URL=http://127.0.0.1:8787/api/projects/export \
CF_BUILD_TOKEN=<dev-token> \
node scripts/fetch-projects.mjs && bundle exec jekyll serve
```

---

*Documento atualizado para a branch **`temp`**. Ajuste `url` em `_config.yml` conforme ambiente (local, staging, produção). Plano de migração backend em `.cursor/plans/backend_cms_migration_45b7ab64.plan.md`.*
