[![Netlify Status](https://api.netlify.com/api/v1/badges/420411eb-df4b-4f05-bcbd-ffa096277a13/deploy-status)](https://app.netlify.com/projects/reversofilmessite/deploys)

# Reverso Filmes — site

Site estático (Jekyll), com conteúdo do CMS servido por Worker na Cloudflare.

## Rodar localmente

Pré-requisitos: Ruby (Bundler), Node.js.

```powershell
bundle install
```

Sincronizar dados do export do Worker e subir o servidor de preview:

```powershell
$env:WORKER_EXPORT_URL = "https://reverso-cms-api.reversofilmes.workers.dev/api/projects/export"
$env:CF_BUILD_TOKEN = "<BUILD_TOKEN — mesmo valor do Worker e do Netlify>"
node scripts/fetch-projects.mjs
bundle exec jekyll serve
```

`CF_BUILD_TOKEN` não é o token de login do GitHub no admin; é o JWT de build (gerado no projeto `cf-worker`, secret `BUILD_TOKEN`).

Para só pré-visualizar sem novo fetch, use `bundle exec jekyll serve` direto (usa o `_data/` já existente no disco).
