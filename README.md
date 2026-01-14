[![Netlify Status](https://api.netlify.com/api/v1/badges/420411eb-df4b-4f05-bcbd-ffa096277a13/deploy-status)](https://app.netlify.com/projects/reversofilmessite/deploys)

# site
Site Reverso Filmes

## Locally

`bundle exec jekyll serve`

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