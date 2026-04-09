/**
 * Media upload validation & path helpers
 */
const MediaUpload = {
  MAX_SIZE: 25 * 1024 * 1024,
  IMG_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  VID_TYPES: ['video/mp4', 'video/webm'],

  validate(file, types) {
    if (!types.includes(file.type)) {
      throw new Error(
        `Tipo ${file.type} não permitido. Aceitos: ${types.join(', ')}`,
      );
    }
    if (file.size > this.MAX_SIZE) {
      throw new Error(
        `Arquivo ${(file.size / 1048576).toFixed(1)} MB excede limite de 25 MB`,
      );
    }
  },

  imgPath(file, slug) {
    const ext = file.name.split('.').pop().toLowerCase();
    return `assets/img/projects/${slug}-thumbnail.${ext}`;
  },

  vidPath(file, slug) {
    const ext = file.name.split('.').pop().toLowerCase();
    return `assets/video/projects/${slug}-preview.${ext}`;
  },

  preview(file) { return URL.createObjectURL(file); },
  revokePreview(url) { if (url) URL.revokeObjectURL(url); },
};
