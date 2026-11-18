# Vexcast — notas de desarrollo

- Monorepo: Rust (`crates/vexcast-core`, `crates/vexcast-server`, `apps/desktop/src-tauri`) + pnpm (`apps/desktop`, `apps/mobile`, `packages/*`).
- El contrato de datos está en `packages/protocol/src/types.ts` y se refleja en `crates/vexcast-core/src/model.rs` (serde camelCase). Cambia ambos a la vez y actualiza `docs/API.md`.
- Tests: `cargo test -p vexcast-core`, `pnpm typecheck`, `pnpm --filter @vexcast/desktop build`.
- Probar el núcleo real sin Tauri: `cargo run --release -p vexcast-server -- --port 7499 --ui-dir apps/desktop/dist` (usa un puerto libre; 7420 suele estar ocupado por el mock).
- Commits: sin líneas de coautoría ni atribuciones automáticas; autor emanueldev1 <90418449+emanueldev1@users.noreply.github.com>.
- Textos de la interfaz: español por defecto, con traducción al inglés (`apps/desktop/src/i18n`).
