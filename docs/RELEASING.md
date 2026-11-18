# Publicar una versión

Las versiones se construyen y publican solas con GitHub Actions (`.github/workflows/release.yml`).

## Configuración única: clave del actualizador

El actualizador integrado solo instala paquetes **firmados** con la clave del proyecto. La clave pública ya está en `apps/desktop/src-tauri/tauri.conf.json`. La privada **no** se sube al repositorio:

1. GitHub → **Settings → Secrets and variables → Actions → New repository secret**.
2. Crea `TAURI_SIGNING_PRIVATE_KEY` con el contenido completo del archivo de clave privada.
3. Crea `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` con su contraseña. Si no tiene contraseña, déjalo vacío (o no lo crees).

> ⚠️ Guarda una copia de la clave privada en un lugar seguro (gestor de contraseñas). Si se pierde, las instalaciones existentes no podrán actualizarse automáticamente a versiones firmadas con otra clave.

Para generar una clave nueva:

```bash
pnpm --filter @vexcast/desktop tauri signer generate -w vexcast-updater.key
```

Después reemplaza `plugins.updater.pubkey` en `tauri.conf.json` con el contenido de `vexcast-updater.key.pub`.

## Cada versión

Sube la versión en todos los paquetes:

```bash
node scripts/bump-version.mjs 0.2.0
```

Haz el commit:

```bash
git commit -am "Release v0.2.0"
```

Crea la etiqueta:

```bash
git tag v0.2.0
```

Sube el commit y la etiqueta:

```bash
git push && git push --tags
```

El workflow:
1. Crea un release en borrador.
2. Compila los instaladores de **Windows** (con FFmpeg incluido), **macOS** (Apple Silicon e Intel) y **Linux** (AppImage, deb y rpm), firma los paquetes de actualización y sube `latest.json`.
3. Compila el **APK de Android** de la app de control remoto y el **servidor sin interfaz** para cada sistema.
4. Publica el release.

Las apps instaladas comprueban `https://github.com/vexcast/vexcast/releases/latest/download/latest.json` al arrancar y cada 6 horas. La app móvil consulta la API de releases una vez al día.
