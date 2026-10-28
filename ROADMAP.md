# Ideas para la próxima versión

Aún sin empezar.

- [ ] **Idioma inglés / español**: un selector de idioma en la configuración. Se puede hacer con la carpeta `_locales/` de Firefox (`browser.i18n`), o con una tabla de textos propia si se quiere cambiar de idioma sin depender del idioma de Firefox.
- [ ] **Recordatorio al entrar a una web con límite**: un cuadrito discreto pero visible, por ejemplo en una esquina, que diga que el tiempo está contando o que esta página pertenece a un grupo. No debe ser de pantalla completa. Se puede activar o desactivar por grupo. Necesita un *content script*.
- [ ] **Actualizaciones automáticas por GitHub**:
  - poner `update_url` en `manifest.json`, apuntando a un `updates.json` dentro del repo;
  - subir cada `.xpi` firmado a un GitHub Release.
- [ ] **Cuenta regresiva en una esquina**: que aparezca cuando quedan 30 segundos o menos, antes de que se bloquee la página por el límite de tiempo, o cuando se acaba un descanso. Usa el mismo *content script* que el recordatorio.
