# Cuentas: «Conectar con Twitch / Kick / YouTube»

Para que los botones de inicio de sesión funcionen, el proyecto necesita **una app registrada en cada plataforma**. Se hace una sola vez, con la cuenta del dueño del proyecto, y los IDs públicos se ponen en [`crates/vexcast-core/src/oauth_config.rs`](../crates/vexcast-core/src/oauth_config.rs). También se pueden pasar con variables de entorno del mismo nombre: `VEXCAST_TWITCH_CLIENT_ID`, etc.

## Twitch (solo el Client ID, sin secreto)

1. Activa la verificación en dos pasos en tu cuenta de Twitch; es obligatoria para registrar apps.
2. Entra en **https://dev.twitch.tv/console/apps** y pulsa **Register Your Application**.
3. Rellena:
   - **Name**: `Vexcast` (si está ocupado, `Vexcast Studio`).
   - **OAuth Redirect URLs**: `http://localhost:7420/oauth/callback`
   - **Category**: *Broadcaster Suite*
   - **Client Type**: **Public**. Así no hace falta secreto: Vexcast usa el *Device Code Flow*.
4. Pulsa **Create**, luego **Manage**, y copia el **Client ID**.
5. Pégalo en `TWITCH_CLIENT_ID`.

Con la cuenta conectada, Vexcast puede rellenar la clave de transmisión, usar el chat con permiso de escritura, cambiar el título y la categoría y leer follows, subs y bits.

## Kick (Client ID + secreto mediante un mini proxy)

1. En Kick ve a **Configuración → Developer** (**https://kick.com/settings/developer**) y crea una app.
2. Rellena:
   - **Redirect URL**: `http://localhost:7420/oauth/callback`
   - **Scopes**: `user:read`, `channel:read`, `channel:write`, `chat:write`, `streamkey:read`, `events:subscribe`.
3. Copia el **Client ID** en `KICK_CLIENT_ID`.
4. El **Client Secret** **no** se pone en el código. Despliega el proxy gratuito [`scripts/kick-token-proxy.js`](../scripts/kick-token-proxy.js) en Cloudflare Workers (las instrucciones están en el propio archivo) y pon su URL en `KICK_TOKEN_PROXY` (`oauth_config.rs`). Vexcast usa siempre esa dirección; no se configura con variables de entorno.
   - En compilaciones solo tuyas también puedes definir la variable `VEXCAST_KICK_CLIENT_SECRET`, sin proxy.

## YouTube (Client ID + secreto «de escritorio»)

> De momento el botón «Conectar con YouTube» está oculto en la interfaz (`ACCOUNT_PLATFORMS` en `apps/desktop/src/components/accounts/connect-button.tsx`) porque Google exige verificar la app. El núcleo ya lo soporta; para activarlo, configura lo siguiente y vuelve a añadir `"youtube"` a esa lista.

1. Entra en **https://console.cloud.google.com/** y crea un proyecto llamado «Vexcast».
2. **APIs y servicios → Biblioteca**: activa **YouTube Data API v3**.
3. **Pantalla de consentimiento de OAuth**: elige el tipo *Externo*, pon el nombre de la app, tu correo y el scope `.../auth/youtube.force-ssl`. Mientras esté «en pruebas», añade como *usuarios de prueba* las cuentas que la usarán. Para abrirla a todos, Google pide una verificación gratuita.
4. **Credenciales → Crear credenciales → ID de cliente de OAuth → App de escritorio**.
5. Copia el **ID de cliente** en `YOUTUBE_CLIENT_ID` y el **secreto** en `YOUTUBE_CLIENT_SECRET`. Google considera no confidencial el secreto de las apps de escritorio, así que puede ir en la app.

## Publicar sin dejar las claves en el código

En vez de editar `oauth_config.rs`, define en GitHub (**Settings → Secrets and variables → Actions → Variables**) `VEXCAST_TWITCH_CLIENT_ID`, `VEXCAST_KICK_CLIENT_ID`, `VEXCAST_YOUTUBE_CLIENT_ID` y `VEXCAST_YOUTUBE_CLIENT_SECRET`. El workflow de publicación los inyecta al compilar.
