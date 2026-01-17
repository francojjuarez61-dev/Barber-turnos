# Turnos Barbería (PWA)

Aplicación web progresiva (PWA) para gestión de turnos espontáneos en barbería.

## Deploy en GitHub Pages

1. Creá un repo (por ejemplo `turnos-barberia`).
2. Subí estos archivos al root del repo.
3. En GitHub: **Settings → Pages**
   - Source: **Deploy from a branch**
   - Branch: **main** / **root**
4. Esperá a que publique (te queda una URL tipo `https://TUUSUARIO.github.io/turnos-barberia/`).

## Uso rápido

- Botón grande **Iniciar**: abre menú radial y arranca un servicio.
- Botón **Agregar a espera**: abre menú radial y agrega un servicio a la cola.
- **Finalizar actual**: termina el servicio en curso (no inicia el siguiente).
- **Color/Permanente**: al tocarlos en el menú radial se inician como **paralelos** y se finalizan manualmente en la sección correspondiente.

## Offline

Incluye `sw.js` (service worker) + `manifest.json` para funcionar offline y poder agregarse a pantalla de inicio.
