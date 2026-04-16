[![Netlify Status](https://api.netlify.com/api/v1/badges/420411eb-df4b-4f05-bcbd-ffa096277a13/deploy-status)](https://app.netlify.com/projects/reversofilmessite/deploys)

# site
Site Reverso Filmes

## Ambiente local

### Dados do portfólio (`_data/projects.json`)

O Jekyll **não** lê o D1 em tempo real. A home e o `/projects.json` usam **`_data/projects.json`**, gerado pelo script de export (`scripts/fetch-projects.mjs`), com os mesmos dados que o Netlify pega no build.

Enquanto você edita no painel admin, o **build local fica desatualizado** até rodar esse script de novo (ou puxar do Git um `_data/projects.json` que outra pessoa já tenha gerado).

**Token:** use o **token de build / export** do Worker (`CF_BUILD_TOKEN` no ambiente — o mesmo valor configurado no Netlify / `cf-worker` / `.dev.vars`). **Não** é o token de sessão do GitHub no admin (`AUTH_TOKEN` / cookie da API).

No PowerShell, na raiz do repositório:

```powershell
$env:WORKER_EXPORT_URL = "https://reverso-cms-api.reverso-cms.workers.dev/api/projects/export"
$env:CF_BUILD_TOKEN = "<mesmo BUILD_TOKEN do Worker / Netlify / .dev.vars>"
node scripts/fetch-projects.mjs
```

Ajuste `WORKER_EXPORT_URL` para a URL real do seu Worker (tem que ser o endpoint `/api/projects/export`, alinhado ao `netlify.toml` e ao `WORKER_EXPORT_URL` do deploy).

Depois, rode o Jekyll e confira a home e o portfólio no navegador:

```powershell
bundle exec jekyll serve
```

Para apenas pré-visualizar sem sincronizar dados, rode `bundle exec jekyll serve` direto — o `_data/projects.json` continua sendo o que já estiver no disco.

## Project File Naming Convention

All project files in `_projects/` must follow this standardized format:

**Format:** `DATE-ProjectName-Client.md`

**Example:** `250618-RedBullCia2025-RedBull.md`

### Rules:
1. **Date**: Use format `YYMMDD` (e.g., `250618` for June 18, 2025)
2. **Project Name**: Use CamelCase, no spaces, no special characters (á→a, é→e, ç→c, etc.)
3. **Client**: Use CamelCase, no spaces, no special characters
4. **Separator**: Use hyphens (`-`) between date, project name, and client

### File Paths:
- **Thumbnail**: `/assets/img/projects/DATE-ProjectName-Client-thumbnail.jpg`
- **Hover Preview Video**: `/assets/video/projects/DATE-ProjectName-Client-preview.mp4`

### Example Front Matter:
```yaml
---
title: "Project Title (can have spaces and special chars)"
thumbnail: /assets/img/projects/250618-RedBullCia2025-RedBull-thumbnail.jpg
hover_preview: /assets/video/projects/250618-RedBullCia2025-RedBull-preview.mp4
service_types:
  - CATEGORY
client: "ClientName"
date_mmddyyyy: "06182025"
year: 2025
show_on_home: true
order: 1
---
```

**Note**: The filename uses slugs (no special characters), but the `title` field can contain spaces and special characters for display purposes.