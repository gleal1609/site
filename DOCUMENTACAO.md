# Documentação — Site Reverso Filmes (Jekyll)

Este documento descreve a estrutura do projeto na branch **`temp`** (versão completa: masonry na home, listagem de projetos, páginas internas e navegação inferior). A branch **`main`** pode estar mais enxuta; para desenvolvimento alinhado ao site em staging, use **`temp`**.

Inclui como rodar localmente, mapa de arquivos, fluxo de dados dos projetos e orientações para CMS / painel administrativo com foco em soluções **gratuitas e sustentáveis**.

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
├── _projects/               # Um arquivo .md por projeto (coleção Jekyll)
├── admin/                   # Painel CMS (index.html + config.yml) → copiado para _site/admin/
├── assets/
│   ├── css/                 # main.css, bottom-nav.css
│   ├── js/                  # intro, transições, masonry (Packery), página de projetos, nav
│   ├── img/                 # Referenciado pelos projetos (pode não estar todo no Git)
│   └── video/               # Previews para hover (idem)
├── index.markdown           # layout: home
├── projects.markdown        # permalink /projetos/ → layout projects
├── projects.json            # Lista JSON de todos os projetos (para Alpine na página Projetos)
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
| `/projects/<slug>/` | Arquivos em `_projects/*.md` |
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
| `youtube_url` / `pixieset_url` | Opcionais na página de detalhe |

**Convenção de nome do arquivo:** `YYMMDD-NomeProjeto-Cliente.md` (sem acentos no nome do arquivo); caminhos de mídia seguem o padrão descrito no `README.md`.

### 2.8 `projects.json`

Arquivo Jekyll com `layout: null` e `permalink: /projects.json`. Gera um **array JSON** com um objeto por projeto (título, URLs, flags de home, ordem, `search_blob` para busca, etc.), usado pela página `/projetos/`.

---

## 3. CMS e painel administrativo (`/admin/`)

A **masonry da home** e a **ordem/tamanho** dos cartões vêm dos campos no front matter em `_projects/`. O painel em **`/admin/`** usa **Sveltia CMS** (primário), com o mesmo formato de `admin/config.yml` que o **Decap CMS** (alternativa). O backend é **GitHub** direto (sem Git Gateway nem Netlify Identity). Em produção na **Netlify**, o login usa **GitHub OAuth** via **proxy OAuth da Netlify** (`https://api.netlify.com/auth/done`). O repositório configurado é **`reversofilmes/site`**; a branch de trabalho do CMS é **`temp`**.

### 3.1 Site estático e Git

O Jekyll gera HTML estático. O CMS grava **commits** no repositório (Markdown em `_projects/` e arquivos em `assets/img/projects/` e `assets/video/projects/`). O Netlify **rebuilda** no push. Não há banco de dados no site.

### 3.2 Produção: OAuth GitHub + Netlify

1. **GitHub:** criar um **OAuth App** (organização ou conta da equipe) com **Callback URL** `https://api.netlify.com/auth/done` e **Homepage URL** do site (ex.: staging `https://temp.reversofilmes.com.br`).
2. **Netlify:** Site settings → Access & security → OAuth → instalar o provedor **GitHub** com o **Client ID** e **Client Secret** do OAuth App. O **secret** fica só no painel Netlify, nunca no repositório.
3. **No `admin/config.yml`:** não incluir `client_id`, `base_url` nem `auth_endpoint` — no deploy Netlify o Sveltia detecta o domínio e usa o proxy.

**Quem publica:** cada pessoa precisa de **conta GitHub própria** (recomenda-se **2FA**) e ser **colaboradora** do repositório com permissão de escrita. Evite uma única conta compartilhada com senha repassada.

### 3.3 Desenvolvimento e demos: token (PAT)

Quando o OAuth via Netlify não for prático (ex.: `localhost`), o Sveltia permite autenticação com **Personal Access Token** no fluxo de login por token (conforme documentação do backend GitHub). Gere o token no GitHub com escopo mínimo para o repositório, use **apenas em ambiente local**, **não commite** o token e **revogue** após testes.

Para demonstração ao cliente, prefira uma **URL de staging na Netlify** (mesmo fluxo OAuth que produção).

### 3.4 Branch protection (GitHub — configurar manualmente)

- **`main`:** exigir PR antes do merge; bloquear force push e deleção da branch (ajuste conforme política da equipe).
- **`temp`:** branch usada pelo CMS com **commit direto** — **não** exigir PR aqui (bloquearia o fluxo), salvo uso de *editorial workflow* no CMS. Bloquear force push e deleção da branch.

### 3.5 Validação de mídia (GitHub Actions)

O workflow **`.github/workflows/validate-uploads.yml`** roda em pushes/PRs que alteram `assets/img/projects/` ou `assets/video/projects/`: permite imagens `.jpg`, `.jpeg`, `.png`, `.webp`; vídeos `.mp4` e `.webm`; tamanho máximo **25MB** por arquivo. Um push pode acionar em paralelo o deploy Netlify e este job — o job **alerta** com check vermelho; **não** bloqueia o deploy por si só (para gating forte seria necessário ex.: PR + required checks ou deploy condicionado).

### 3.6 Segurança e superfície

- **`/admin/`** é URL pública; a proteção é o **login GitHub**.
- Ameaças comuns: phishing e sequestro de sessão — treinar quem usa o painel.
- **CDN:** o `admin/index.html` pinna a versão do Sveltia (`@sveltia/cms@0.152.0`) para reduzir risco de supply chain.

### 3.7 Limitações e fallback Sveltia → Decap

- **Upload:** limite ~**25MB** por arquivo na API do GitHub; vídeos de hover devem ser curtos e otimizados.
- **Slug de arquivo:** novos projetos pelo CMS seguem o padrão configurado em `slug` no `config.yml`; pode divergir da convenção manual `YYMMDD-Nome-Cliente.md` — renomear no Git se precisar alinhar.
- **Fallback Decap:** trocar o script em `admin/index.html` para o CDN do Decap e ajustar `admin/config.yml`: **`media_libraries`** (Sveltia) → **`media_library`** (Decap, estrutura diferente). Não é apenas uma linha.

### 3.8 O que o painel cobre

Coleção **projects** (`_projects/`), thumbnails em **`/assets/img/projects`**, vídeo de hover em **`/assets/video/projects`**, campos alinhados ao front matter atual (incluindo corpo Markdown). Layouts, CSS, JS e `_config.yml` continuam no Git pela equipe técnica.

---

## 4. Referências rápidas

- Jekyll: https://jekyllrb.com/docs/
- Coleções: https://jekyllrb.com/docs/collections/
- Sveltia CMS: https://github.com/sveltia/sveltia-cms
- Decap CMS (alternativa): https://decapcms.org/docs/
- Tema Minima: https://github.com/jekyll/minima
- Packery (masonry): https://packery.metafizzy.co/

---

*Documento atualizado para a branch **`temp`**. Ajuste `url` em `_config.yml` conforme ambiente (local, staging, produção).*
