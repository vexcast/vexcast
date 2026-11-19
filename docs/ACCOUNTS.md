# Accounts: "Connect with Twitch / Kick / YouTube"

For the sign-in buttons to work, the project needs **an app registered on each platform**. This is done once, with the project owner's account, and the public IDs go in [`crates/vexcast-core/src/oauth_config.rs`](../crates/vexcast-core/src/oauth_config.rs). They can also be passed as environment variables with the same name: `VEXCAST_TWITCH_CLIENT_ID`, etc.

## Twitch (Client ID only, no secret)

1. Enable two-factor authentication on your Twitch account; it's required to register apps.
2. Go to **https://dev.twitch.tv/console/apps** and click **Register Your Application**.
3. Fill in:
   - **Name**: `Vexcast` (if taken, `Vexcast Studio`).
   - **OAuth Redirect URLs**: `http://localhost:7420/oauth/callback`
   - **Category**: *Broadcaster Suite*
   - **Client Type**: **Public**. This way no secret is needed: Vexcast uses the *Device Code Flow*.
4. Click **Create**, then **Manage**, and copy the **Client ID**.
5. Paste it into `TWITCH_CLIENT_ID`.

With the account connected, Vexcast can fill in the stream key, use chat with write permission, change the title and category, and read follows, subs and bits.

## Kick (Client ID + secret via a small proxy)

1. On Kick, go to **Settings → Developer** (**https://kick.com/settings/developer**) and create an app.
2. Fill in:
   - **Redirect URL**: `http://localhost:7420/oauth/callback`
   - **Scopes**: `user:read`, `channel:read`, `channel:write`, `chat:write`, `streamkey:read`, `events:subscribe`.
3. Copy the **Client ID** into `KICK_CLIENT_ID`.
4. The **Client Secret** does **not** go in the code. Deploy the free proxy [`scripts/kick-token-proxy.js`](../scripts/kick-token-proxy.js) to Cloudflare Workers (instructions are in the file itself) and put its URL in `KICK_TOKEN_PROXY` (`oauth_config.rs`). Vexcast always uses that address; it isn't configurable through environment variables.
   - For builds that only you use, you can also set the `VEXCAST_KICK_CLIENT_SECRET` variable, without a proxy.

## YouTube (Client ID + "desktop" secret)

> For now the "Connect with YouTube" button is hidden in the UI (`ACCOUNT_PLATFORMS` in `apps/desktop/src/components/accounts/connect-button.tsx`) because Google requires the app to be verified. The core already supports it; to enable it, configure the following and add `"youtube"` back to that list.

1. Go to **https://console.cloud.google.com/** and create a project named "Vexcast".
2. **APIs & Services → Library**: enable **YouTube Data API v3**.
3. **OAuth consent screen**: choose the *External* type, and enter the app name, your email and the `.../auth/youtube.force-ssl` scope. While it's "in testing", add the accounts that will use it as *test users*. To open it to everyone, Google requires a free verification.
4. **Credentials → Create credentials → OAuth client ID → Desktop app**.
5. Copy the **client ID** into `YOUTUBE_CLIENT_ID` and the **secret** into `YOUTUBE_CLIENT_SECRET`. Google doesn't consider desktop app secrets confidential, so it can ship inside the app.

## Releasing without keeping the keys in the code

Instead of editing `oauth_config.rs`, define `VEXCAST_TWITCH_CLIENT_ID`, `VEXCAST_KICK_CLIENT_ID`, `VEXCAST_YOUTUBE_CLIENT_ID` and `VEXCAST_YOUTUBE_CLIENT_SECRET` on GitHub (**Settings → Secrets and variables → Actions → Variables**). The release workflow injects them at build time.
