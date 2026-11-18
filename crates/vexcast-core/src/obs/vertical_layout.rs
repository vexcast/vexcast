//! "Arrange for vertical": rebuild a scene's 9:16 twin from its 16:9 layout.
//!
//! `auto` (TikTok / Shorts style): the camera and whatever frames it on top, the game or screen
//! filling the middle, the small info items (labels, icons…) along the bottom, alerts centered
//! over the game and full-canvas backgrounds filling everything behind.
//! `fit`: the whole 16:9 scene scaled to the vertical width and centered (backgrounds fill).

use super::model::{SceneItem, SceneItemPatch, Vec2};
use super::Engine;

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Role {
    Camera,
    Screen,
    Alerts,
    /// A chat widget: TikTok/Reels/Shorts show their own comments, so the tiktok mode leaves it out.
    Chat,
    Background,
    Other,
}

pub fn role_for(kind: &str, url: &str) -> Role {
    match kind {
        "dshow_input" | "av_capture_input" | "av_capture_input_v2" | "v4l2_input" | "macos-avcapture" | "macos-avcapture-fast" => Role::Camera,
        "game_capture" | "monitor_capture" | "window_capture" | "screen_capture" | "display_capture" | "xshm_input" | "xcomposite_input" | "pipewire-desktop-capture-source" | "pipewire-window-capture-source" | "pipewire-screen-capture-source" => Role::Screen,
        k if k.starts_with("browser_source") && url.contains("/widgets/alerts.html") => Role::Alerts,
        k if k.starts_with("browser_source") && url.contains("/widgets/chat") => Role::Chat,
        _ => Role::Other,
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    fn area(&self) -> f64 {
        self.w.max(0.0) * self.h.max(0.0)
    }
    fn union(&self, o: &Rect) -> Rect {
        let (x, y) = (self.x.min(o.x), self.y.min(o.y));
        Rect { x, y, w: (self.x + self.w).max(o.x + o.w) - x, h: (self.y + self.h).max(o.y + o.h) - y }
    }
    fn clip(&self, o: &Rect) -> Option<Rect> {
        let (x, y) = (self.x.max(o.x), self.y.max(o.y));
        let (x1, y1) = ((self.x + self.w).min(o.x + o.w), (self.y + self.h).min(o.y + o.h));
        (x1 - x > 1.0 && y1 - y > 1.0).then(|| Rect { x, y, w: x1 - x, h: y1 - y })
    }
    fn overlap(&self, o: &Rect) -> f64 {
        let w = (self.x + self.w).min(o.x + o.w) - self.x.max(o.x);
        let h = (self.y + self.h).min(o.y + o.h) - self.y.max(o.y);
        if w > 0.0 && h > 0.0 {
            w * h
        } else {
            0.0
        }
    }
}

/// One item of the horizontal scene, as the planner sees it.
#[derive(Debug, Clone)]
pub struct PlanItem {
    pub item: SceneItem,
    pub role: Role,
    pub rect: Rect,
}

/// Where an item goes on the vertical canvas.
#[derive(Debug, Clone, PartialEq)]
pub enum Place {
    /// Same look, moved and scaled: pos' = (ox, oy) + (pos - (cx, cy)) * s.
    Map { cx: f64, cy: f64, ox: f64, oy: f64, s: f64 },
    /// Fill the box, cropping what overflows (keeps the aspect ratio).
    Fill(Rect),
}

/// Visible rectangle of an item on its canvas (rotation ignored). Unknown sizes (a game not
/// hooked yet, a camera that is off) use `fallback`.
pub fn item_rect(it: &SceneItem, fallback: (f64, f64)) -> Rect {
    let (sw, sh) = if it.source_width > 0 && it.source_height > 0 { (it.source_width as f64, it.source_height as f64) } else { fallback };
    let (w, h) = if it.bounds_type != "none" && it.bounds.x > 0.0 && it.bounds.y > 0.0 {
        (it.bounds.x, it.bounds.y)
    } else {
        let c = &it.crop;
        (((sw - c.left as f64 - c.right as f64).max(1.0)) * it.scale.x.abs(), ((sh - c.top as f64 - c.bottom as f64).max(1.0)) * it.scale.y.abs())
    };
    let a = it.alignment;
    let x = if a & 1 != 0 { it.pos.x } else if a & 2 != 0 { it.pos.x - w } else { it.pos.x - w / 2.0 };
    let y = if a & 4 != 0 { it.pos.y } else if a & 8 != 0 { it.pos.y - h } else { it.pos.y - h / 2.0 };
    Rect { x, y, w, h }
}

/// Uniformly fit `r` into `boxr` (centered) and return the mapping.
fn fit(r: &Rect, boxr: &Rect, max_scale: f64) -> (Place, Rect) {
    let s = (boxr.w / r.w.max(1.0)).min(boxr.h / r.h.max(1.0)).min(max_scale);
    let (w, h) = (r.w * s, r.h * s);
    let (ox, oy) = (boxr.x + (boxr.w - w) / 2.0, boxr.y + (boxr.h - h) / 2.0);
    (Place::Map { cx: r.x, cy: r.y, ox, oy, s }, Rect { x: ox, y: oy, w, h })
}

/// Group rects into horizontal rows (overlapping vertical ranges), top to bottom: (members, union).
fn rows_of(items: &[(usize, Rect)]) -> Vec<(Vec<usize>, Rect)> {
    let mut sorted = items.to_vec();
    sorted.sort_by(|a, b| (a.1.y + a.1.h / 2.0).total_cmp(&(b.1.y + b.1.h / 2.0)));
    let mut rows: Vec<(Vec<usize>, Rect)> = vec![];
    for (i, r) in sorted {
        let joins = rows.last().is_some_and(|(_, u)| {
            let ov = (u.y + u.h).min(r.y + r.h) - u.y.max(r.y);
            ov > r.h.min(u.h) * 0.3
        });
        if joins {
            let last = rows.last_mut().unwrap();
            last.0.push(i);
            last.1 = last.1.union(&r);
        } else {
            rows.push((vec![i], r));
        }
    }
    rows
}

/// Plan the vertical layout. Returns (index into `items`, place) in bottom-to-top order.
pub fn plan(items: &[PlanItem], main: (f64, f64), vert: (f64, f64), mode: &str) -> Vec<(usize, Place)> {
    if mode == "tiktok" {
        return plan_tiktok(items, main, vert, false);
    }
    let (mw, mh) = main;
    let (vw, vh) = vert;
    let canvas = Rect { x: 0.0, y: 0.0, w: mw, h: mh };
    let full = Rect { x: 0.0, y: 0.0, w: vw, h: vh };
    let covers = |r: &Rect| canvas.overlap(r) >= canvas.area() * 0.8;
    let is_bg = |p: &PlanItem| p.role == Role::Other && covers(&p.rect);
    let mut out: Vec<(usize, Place)> = vec![];
    // Backgrounds go first (bottom), filling the whole vertical canvas.
    for (i, p) in items.iter().enumerate() {
        if is_bg(p) {
            out.push((i, Place::Fill(full)));
        }
    }
    if mode == "fit" {
        let (place, _) = fit(&canvas, &full, f64::MAX);
        for (i, p) in items.iter().enumerate() {
            if !is_bg(p) {
                out.push((i, place.clone()));
            }
        }
        return out;
    }

    // Camera cluster: the cameras plus what frames them (mostly on top of them, not much bigger).
    let cams: Vec<usize> = items.iter().enumerate().filter(|(_, p)| p.role == Role::Camera).map(|(i, _)| i).collect();
    let cam_rect = cams.iter().map(|i| items[*i].rect).reduce(|a, b| a.union(&b));
    let mut cluster = vec![false; items.len()];
    if let Some(cr) = cam_rect {
        for (i, p) in items.iter().enumerate() {
            let ov = p.rect.overlap(&cr);
            // On top of the camera, or around it (a frame that contains it), and not much bigger.
            let framing = p.role == Role::Other && !is_bg(p) && (ov >= p.rect.area() * 0.6 || ov >= cr.area() * 0.6) && p.rect.area() <= cr.area() * 4.0;
            if p.role == Role::Camera || framing {
                cluster[i] = true;
            }
        }
    }
    let cam_union = items.iter().enumerate().filter(|(i, _)| cluster[*i]).map(|(_, p)| p.rect).reduce(|a, b| a.union(&b));
    let info: Vec<usize> = items.iter().enumerate().filter(|(i, p)| !cluster[*i] && matches!(p.role, Role::Other | Role::Chat) && !is_bg(p)).map(|(i, _)| i).collect();
    let margin = vh * 0.025;
    let mut top = 0.0;
    let mut cam_place = None;
    if let Some(cu) = cam_union {
        let (place, r) = fit(&cu, &Rect { x: 0.0, y: margin, w: vw, h: vh * 0.33 }, f64::MAX);
        top = r.y + r.h + margin * 0.5;
        cam_place = Some(place);
    }
    let mut bottom = vh;
    // Info items in rows (items sharing a horizontal band), each row as wide as fits, stacked
    // along the bottom.
    let mut info_place: Vec<Option<Place>> = vec![None; items.len()];
    let rows = rows_of(&info.iter().map(|i| (*i, items[*i].rect)).collect::<Vec<_>>());
    if !rows.is_empty() {
        let gap = margin * 0.4;
        let mut scales: Vec<f64> = rows.iter().map(|(_, r)| (vw * 0.92 / r.w.max(1.0)).min(1.3)).collect();
        let total: f64 = rows.iter().zip(&scales).map(|((_, r), s)| r.h * s).sum::<f64>() + gap * (rows.len() - 1) as f64;
        let room = vh * 0.3;
        if total > room {
            let k = room / total;
            scales.iter_mut().for_each(|s| *s *= k);
        }
        let mut y = vh - margin;
        for ((members, r), s) in rows.iter().zip(&scales).rev() {
            let (w, h) = (r.w * s, r.h * s);
            y -= h;
            let place = Place::Map { cx: r.x, cy: r.y, ox: (vw - w) / 2.0, oy: y, s: *s };
            for m in members {
                info_place[*m] = Some(place.clone());
            }
            y -= gap;
        }
        bottom = y - margin * 0.3;
    }
    let middle = Rect { x: 0.0, y: top, w: vw, h: (bottom - top).max(vh * 0.2) };
    let screens: Vec<usize> = items.iter().enumerate().filter(|(_, p)| p.role == Role::Screen).map(|(i, _)| i).collect();
    let screen_union = screens.iter().map(|i| items[*i].rect).reduce(|a, b| a.union(&b));
    // A full-canvas game fills the middle (cropping the sides); a framed one keeps its look.
    let screen_place = screen_union.map(|su| if covers(&su) { Place::Fill(middle) } else { fit(&su, &middle, f64::MAX).0 });

    for (i, p) in items.iter().enumerate() {
        if is_bg(p) {
            continue;
        }
        let place = if cluster[i] {
            cam_place.clone()
        } else {
            match p.role {
                Role::Screen => match &screen_place {
                    Some(Place::Fill(r)) => Some(Place::Fill(*r)),
                    other => other.clone(),
                },
                Role::Alerts => Some(fit(&p.rect, &Rect { x: vw * 0.05, y: middle.y, w: vw * 0.9, h: middle.h }, 1.0).0),
                _ => info_place[i].clone(),
            }
        };
        if let Some(place) = place {
            out.push((i, place));
        }
    }
    out
}

/// TikTok / Reels / Shorts: their app covers the top (live info) and the bottom (comments,
/// gifts), so everything that matters is stacked between those safe zones: camera on top, the
/// game uncropped at full width, info rows under it. Full-screen backgrounds of the scene become
/// a centered 16:9 card when a vertical background fills behind (`has_bg`), else they fill.
/// Backgrounds drawn over the camera or game (frames with holes) are left out.
pub fn plan_tiktok(items: &[PlanItem], main: (f64, f64), vert: (f64, f64), has_bg: bool) -> Vec<(usize, Place)> {
    let (mw, mh) = main;
    let (vw, vh) = vert;
    let canvas = Rect { x: 0.0, y: 0.0, w: mw, h: mh };
    let covers = |r: &Rect| canvas.overlap(r) >= canvas.area() * 0.8;
    let first_capture = items.iter().position(|p| matches!(p.role, Role::Camera | Role::Screen));
    // Some(true) = background to keep, Some(false) = frame drawn over the captures, None = not one.
    let bg_kind = |i: usize, p: &PlanItem| -> Option<bool> { (p.role == Role::Other && covers(&p.rect)).then(|| first_capture.is_none_or(|c| i < c)) };
    let top = vh * 0.075;
    let limit = vh * 0.78;
    let gap = vh * 0.015;
    let card_h = vw * mh / mw;

    // Camera cluster (camera + frames around it).
    let cams: Vec<usize> = items.iter().enumerate().filter(|(_, p)| p.role == Role::Camera).map(|(i, _)| i).collect();
    let cam_rect = cams.iter().map(|i| items[*i].rect).reduce(|a, b| a.union(&b));
    let mut cluster = vec![false; items.len()];
    if let Some(cr) = cam_rect {
        for (i, p) in items.iter().enumerate() {
            let ov = p.rect.overlap(&cr);
            let framing = p.role == Role::Other && bg_kind(i, p).is_none() && (ov >= p.rect.area() * 0.6 || ov >= cr.area() * 0.6) && p.rect.area() <= cr.area() * 4.0;
            if p.role == Role::Camera || framing {
                cluster[i] = true;
            }
        }
    }
    let cam_union = items.iter().enumerate().filter(|(i, _)| cluster[*i]).map(|(_, p)| p.rect).reduce(|a, b| a.union(&b));
    let screens: Vec<usize> = items.iter().enumerate().filter(|(_, p)| p.role == Role::Screen).map(|(i, _)| i).collect();
    let screen_union = screens.iter().map(|i| items[*i].rect).reduce(|a, b| a.union(&b));
    let cards: Vec<usize> = if has_bg { items.iter().enumerate().filter(|(i, p)| bg_kind(*i, p) == Some(true)).map(|(i, _)| i).collect() } else { vec![] };
    let info: Vec<usize> = items.iter().enumerate().filter(|(i, p)| !cluster[*i] && p.role == Role::Other && bg_kind(*i, p).is_none()).map(|(i, _)| i).collect();
    let rows = rows_of(&info.iter().map(|i| (*i, items[*i].rect)).collect::<Vec<_>>());

    // Heights of the blocks, top to bottom.
    let screen_h = screen_union.map(|su| (vw / su.w.max(1.0)) * su.h).unwrap_or(0.0).min(card_h * 1.2);
    let cards_h = if cards.is_empty() || screen_union.is_some() { 0.0 } else { card_h };
    let mut row_scales: Vec<f64> = rows.iter().map(|(_, r)| (vw * 0.92 / r.w.max(1.0)).min(1.3)).collect();
    let rows_h = |sc: &[f64]| rows.iter().zip(sc).map(|((_, r), s)| r.h * s).sum::<f64>() + gap * rows.len().saturating_sub(1) as f64;
    let max_rows = vh * if screen_union.is_some() || cards_h > 0.0 { 0.12 } else { 0.3 };
    if rows_h(&row_scales) > max_rows {
        let k = max_rows / rows_h(&row_scales);
        row_scales.iter_mut().for_each(|s| *s *= k);
    }
    let info_h = if rows.is_empty() { 0.0 } else { rows_h(&row_scales) };
    let blocks = [screen_h, cards_h, info_h].iter().filter(|h| **h > 0.0).count() + cam_union.is_some() as usize;
    let fixed = screen_h + cards_h + info_h + gap * 1.5 * blocks.saturating_sub(1) as f64;
    let cam_box_h = (limit - top - fixed).max(vh * 0.18);
    let (cam_place, cam_h) = match cam_union {
        Some(cu) => {
            let (p, r) = fit(&cu, &Rect { x: vw * 0.03, y: 0.0, w: vw * 0.94, h: cam_box_h }, f64::MAX);
            (Some(p), r.h)
        }
        None => (None, 0.0),
    };
    let total = cam_h + fixed;
    // Center the stack inside the safe area.
    let mut y = top + ((limit - top) - total).max(0.0) / 2.0;
    let mut place_of: Vec<Option<Place>> = vec![None; items.len()];
    if let Some(Place::Map { cx, cy, ox, oy, s }) = cam_place {
        // fit() centered the cluster vertically in a box at y=0: move it to `y`.
        let p = Place::Map { cx, cy, ox, oy: oy - (cam_box_h - cam_h) / 2.0 + y, s };
        for (i, c) in cluster.iter().enumerate() {
            if *c {
                place_of[i] = Some(p.clone());
            }
        }
        y += cam_h + gap * 1.5;
    }
    let mut middle = Rect { x: 0.0, y, w: vw, h: screen_h.max(cards_h) };
    if let Some(su) = screen_union {
        let (p, _) = fit(&su, &Rect { x: 0.0, y, w: vw, h: screen_h }, f64::MAX);
        for i in &screens {
            place_of[*i] = Some(p.clone());
        }
        y += screen_h + gap * 1.5;
    } else if cards_h > 0.0 {
        let (p, _) = fit(&canvas, &Rect { x: 0.0, y, w: vw, h: card_h }, f64::MAX);
        for i in &cards {
            place_of[*i] = Some(p.clone());
        }
        y += card_h + gap * 1.5;
    } else {
        middle = Rect { x: 0.0, y: top, w: vw, h: limit - top };
    }
    for ((members, r), s) in rows.iter().zip(&row_scales) {
        let (w, h) = (r.w * s, r.h * s);
        let p = Place::Map { cx: r.x, cy: r.y, ox: (vw - w) / 2.0, oy: y, s: *s };
        for m in members {
            place_of[*m] = Some(p.clone());
        }
        y += h + gap;
    }

    let mut out = vec![];
    for (i, p) in items.iter().enumerate() {
        if bg_kind(i, p) == Some(true) && place_of[i].is_none() {
            // No vertical background behind: the scene's own background fills.
            if !has_bg {
                out.push((i, Place::Fill(Rect { x: 0.0, y: 0.0, w: vw, h: vh })));
            }
        } else if p.role == Role::Alerts {
            out.push((i, fit(&p.rect, &Rect { x: vw * 0.05, y: middle.y, w: vw * 0.9, h: middle.h.max(vh * 0.3) }, 1.0).0));
        } else if let Some(pl) = &place_of[i] {
            out.push((i, pl.clone()));
        }
    }
    // Filled backgrounds at the bottom, the rest in the scene's own stacking order.
    out.sort_by_key(|(i, pl)| (!matches!(pl, Place::Fill(_)), *i));
    out
}

/// The patch that puts `it` at `place`.
pub fn patch_for(it: &SceneItem, place: &Place) -> SceneItemPatch {
    let mut p = SceneItemPatch { visible: Some(it.visible), rot: Some(it.rot), crop: Some(it.crop.clone()), ..Default::default() };
    match place {
        Place::Map { cx, cy, ox, oy, s } => {
            // Map the item's rect corner, then put pos back relative to its alignment.
            p.pos = Some(Vec2 { x: ox + (it.pos.x - cx) * s, y: oy + (it.pos.y - cy) * s });
            p.scale = Some(Vec2 { x: it.scale.x * s, y: it.scale.y * s });
            p.alignment = Some(it.alignment);
            p.bounds_type = Some(it.bounds_type.clone());
            p.bounds_alignment = Some(it.bounds_alignment);
            p.bounds = Some(Vec2 { x: it.bounds.x * s, y: it.bounds.y * s });
            p.crop_to_bounds = Some(it.crop_to_bounds);
        }
        Place::Fill(r) => {
            p.pos = Some(Vec2 { x: r.x + r.w / 2.0, y: r.y + r.h / 2.0 });
            p.scale = Some(Vec2 { x: 1.0, y: 1.0 });
            p.rot = Some(0.0);
            p.alignment = Some(0);
            p.bounds_type = Some("scale_outer".into());
            p.bounds_alignment = Some(0);
            p.bounds = Some(Vec2 { x: r.w, y: r.h });
            p.crop_to_bounds = Some(true);
        }
    }
    p
}

impl Engine {
    /// Rebuild the vertical twin of `main_uuid` from its horizontal layout (`auto`, `tiktok` or `fit`),
    /// optionally over a vertical `background` source that fills the canvas.
    /// Returns how many items the twin has now.
    pub fn arrange_vertical(&self, main_uuid: &str, mode: &str, background: Option<&str>) -> anyhow::Result<usize> {
        self.require_ready()?;
        let snap = self.snapshot();
        let scene = snap.scenes.iter().find(|s| s.uuid.to_string() == main_uuid).ok_or_else(|| anyhow::anyhow!("Escena no encontrada"))?;
        let twin = scene.vertical_scene_uuid.clone().ok_or_else(|| anyhow::anyhow!("Activa el lienzo vertical en Ajustes › Vídeo"))?;
        let (mw, mh) = unsafe { super::ops::canvas_size() };
        let (vw, vh) = self.scene_canvas_size(&twin);
        let items: Vec<PlanItem> = scene
            .items
            .iter()
            .map(|it| {
                let src = snap.sources.iter().find(|s| s.uuid == it.source_uuid);
                let kind = src.map(|s| s.kind.as_str()).unwrap_or("");
                let url = src.and_then(|s| s.settings["url"].as_str()).unwrap_or("");
                let role = if it.is_group { Role::Other } else { role_for(kind, url) };
                let fallback = match role {
                    Role::Screen => (mw as f64, mh as f64),
                    Role::Camera => (1280.0, 720.0),
                    // Media not loaded yet: most often a full-screen video or image.
                    _ => (mw as f64, mh as f64),
                };
                // A nested scene is as big as what it shows, not its whole canvas.
                let nested = snap.scenes.iter().find(|s| s.uuid == it.source_uuid).and_then(|inner| {
                    // What the crop leaves visible of each child, in the nested scene's coordinates.
                    let c = &it.crop;
                    let win = Rect { x: c.left as f64, y: c.top as f64, w: it.source_width as f64 - (c.left + c.right) as f64, h: it.source_height as f64 - (c.top + c.bottom) as f64 };
                    inner
                        .items
                        .iter()
                        .filter(|c| c.visible)
                        .map(|c| item_rect(c, (0.0, 0.0)))
                        .filter_map(|r| r.clip(&win))
                        .reduce(|a, b| a.union(&b))
                });
                let rect = match nested {
                    Some(cb) if it.bounds_type == "none" => {
                        let r = item_rect(it, (mw as f64, mh as f64));
                        let c = &it.crop;
                        Rect { x: r.x + (cb.x - c.left as f64) * it.scale.x, y: r.y + (cb.y - c.top as f64) * it.scale.y, w: cb.w * it.scale.x, h: cb.h * it.scale.y }
                    }
                    _ => item_rect(it, fallback),
                };
                PlanItem { item: it.clone(), role, rect }
            })
            .collect();
        let background = background.filter(|b| !b.is_empty() && snap.sources.iter().any(|s| s.uuid == *b));
        let planned = if mode == "tiktok" { plan_tiktok(&items, (mw as f64, mh as f64), (vw as f64, vh as f64), background.is_some()) } else { plan(&items, (mw as f64, mh as f64), (vw as f64, vh as f64), mode) };
        // Start from an empty twin.
        if let Some(t) = snap.vertical_scenes.iter().find(|s| s.uuid.to_string() == twin) {
            for it in t.items.iter().rev() {
                let _ = self.remove_item(&twin, it.id);
            }
        }
        let mut n = 0;
        // A vertical background (e.g. a 9:16 video) fills behind everything.
        if let Some(bg) = background {
            if let Ok(item) = self.add_source_to_scene(&twin, bg) {
                let fill = Place::Fill(Rect { x: 0.0, y: 0.0, w: vw as f64, h: vh as f64 });
                let _ = self.update_item(&twin, item.id, patch_for(&item, &fill));
                n += 1;
            }
        }
        for (i, place) in &planned {
            let it = &items[*i].item;
            let Ok(new_item) = self.add_source_to_scene(&twin, &it.source_uuid.to_string()) else { continue };
            let _ = self.update_item(&twin, new_item.id, patch_for(it, place));
            n += 1;
        }
        self.changed();
        Ok(n)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::obs::model::Crop;

    fn item(id: i64, x: f64, y: f64, w: u32, h: u32, s: f64) -> SceneItem {
        SceneItem { id, pos: Vec2 { x, y }, scale: Vec2 { x: s, y: s }, alignment: 5, bounds_type: "none".into(), source_width: w, source_height: h, visible: true, crop: Crop::default(), ..Default::default() }
    }

    #[test]
    fn auto_layout_stacks_camera_game_and_info() {
        let main = (1920.0, 1080.0);
        let mk = |it: SceneItem, role| PlanItem { rect: item_rect(&it, if role == Role::Screen { main } else { (1280.0, 720.0) }), item: it, role };
        let items = vec![
            mk(item(1, 0.0, 0.0, 0, 0, 1.0), Role::Screen),
            mk(item(2, 27.0, 644.0, 1280, 720, 0.4), Role::Camera),
            mk(item(3, 10.0, 630.0, 600, 400, 0.95), Role::Other), // camera frame
            mk(item(4, 900.0, 1030.0, 300, 40, 1.0), Role::Other), // label
            mk(item(5, 0.0, 0.0, 1920, 1080, 1.0), Role::Other),   // background
        ];
        let p = plan(&items, main, (1080.0, 1920.0), "auto");
        assert_eq!(p.len(), 5);
        assert_eq!(p[0].0, 4, "background first");
        assert!(matches!(p[0].1, Place::Fill(r) if r.w == 1080.0 && r.h == 1920.0));
        let game = p.iter().find(|(i, _)| *i == 0).unwrap();
        let Place::Fill(g) = game.1 else { panic!("game fills the middle") };
        let cam = p.iter().find(|(i, _)| *i == 1).unwrap();
        let frame = p.iter().find(|(i, _)| *i == 2).unwrap();
        assert_eq!(cam.1, frame.1, "frame moves with the camera");
        let Place::Map { oy: cam_y, .. } = cam.1 else { panic!() };
        assert!(cam_y < g.y, "camera above the game");
        let label = p.iter().find(|(i, _)| *i == 3).unwrap();
        let Place::Map { oy: label_y, .. } = label.1 else { panic!() };
        assert!(label_y >= g.y + g.h - 1.0, "info below the game");
    }

    #[test]
    fn fit_scales_everything_to_width() {
        let it = item(1, 960.0, 540.0, 100, 100, 1.0);
        let items = vec![PlanItem { rect: item_rect(&it, (0.0, 0.0)), item: it.clone(), role: Role::Other }];
        let p = plan(&items, (1920.0, 1080.0), (1080.0, 1920.0), "fit");
        let patch = patch_for(&it, &p[0].1);
        assert!((patch.scale.unwrap().x - 0.5625).abs() < 1e-6);
        assert!((patch.pos.unwrap().x - 540.0).abs() < 1e-6);
    }

    #[test]
    fn tiktok_keeps_safe_zones() {
        let main = (1920.0, 1080.0);
        let mk = |it: SceneItem, role| PlanItem { rect: item_rect(&it, if role == Role::Screen { main } else { (1280.0, 720.0) }), item: it, role };
        let items = vec![
            mk(item(1, 0.0, 0.0, 0, 0, 1.0), Role::Screen),
            mk(item(2, 27.0, 644.0, 1280, 720, 0.4), Role::Camera),
            mk(item(4, 100.0, 1030.0, 600, 40, 1.0), Role::Other),
        ];
        let p = plan_tiktok(&items, main, (1080.0, 1920.0), true);
        assert_eq!(p.len(), 3);
        for (i, pl) in &p {
            let it = &items[*i].item;
            let patch = patch_for(it, pl);
            let y = patch.pos.unwrap().y;
            assert!(y >= 1920.0 * 0.07, "item {i} below the top safe zone");
            let h = items[*i].rect.h * (patch.scale.unwrap().y / it.scale.y.max(1e-9));
            assert!(y + h <= 1920.0 * 0.79, "item {i} above the comments zone");
        }
        let cam_y = patch_for(&items[1].item, &p.iter().find(|(i, _)| *i == 1).unwrap().1).pos.unwrap().y;
        let game_y = patch_for(&items[0].item, &p.iter().find(|(i, _)| *i == 0).unwrap().1).pos.unwrap().y;
        assert!(cam_y < game_y);
    }
}
