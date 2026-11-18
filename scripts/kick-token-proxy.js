// Vexcast — Kick OAuth token proxy (Cloudflare Worker).
//
// Kick requires a client secret to exchange the login code for a token. A secret can't
// ship inside open-source desktop apps, so this tiny worker adds it server-side.
// It stores nothing and only forwards token requests for YOUR Kick app.
//
// Deploy (free Cloudflare account):
//   1. npm i -g wrangler && wrangler login
//   2. wrangler deploy scripts/kick-token-proxy.js --name vexcast-kick --compatibility-date 2024-11-01
//   3. wrangler secret put KICK_CLIENT_ID      (paste your Kick Client ID)
//      wrangler secret put KICK_CLIENT_SECRET  (paste your Kick Client Secret)
//   4. Put https://vexcast-kick.<your-subdomain>.workers.dev/token in KICK_TOKEN_PROXY
//      (crates/vexcast-core/src/oauth_config.rs) or the VEXCAST_KICK_TOKEN_PROXY env var.

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/token") {
      return new Response("Not found", { status: 404 });
    }
    const form = await request.formData();
    const grant = form.get("grant_type");
    if (grant !== "authorization_code" && grant !== "refresh_token") {
      return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
    }
    if (form.get("client_id") !== env.KICK_CLIENT_ID) {
      return Response.json({ error: "invalid_client" }, { status: 400 });
    }
    const body = new URLSearchParams();
    for (const key of ["grant_type", "client_id", "code", "code_verifier", "redirect_uri", "refresh_token"]) {
      const v = form.get(key);
      if (v) body.set(key, v);
    }
    body.set("client_secret", env.KICK_CLIENT_SECRET);
    const r = await fetch("https://id.kick.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    return new Response(await r.text(), { status: r.status, headers: { "Content-Type": "application/json" } });
  },
};
