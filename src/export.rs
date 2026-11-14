//! `knicks export`: the whole site as one HTML file that needs no server.
//! The built page (`npm run build`) goes in with its script and stylesheet
//! inlined, and every document the API would serve goes in as
//! `window.__KNICKS__`, which the page reads instead of fetching.

use std::path::Path;

use anyhow::{Context, Result, anyhow, bail};
use sqlx::mysql::MySqlPool;

use crate::config::TEAM_ID;
use crate::report::load::load_dataset;
use crate::server::DIST;
use crate::{api, sync};

pub async fn export(pool: &MySqlPool, to: &Path) -> Result<()> {
    let data = load_dataset(pool, TEAM_ID).await?;
    let snapshot = snapshot_json(&api::documents(&data)?, sync::checked_at(pool).await?)?;
    let index = std::fs::read_to_string(format!("{DIST}/index.html"))
        .with_context(|| format!("reading {DIST}/index.html; run `npm run build` first"))?;
    let html = inline_assets(&index, &snapshot, |path| {
        std::fs::read_to_string(format!("{DIST}{path}"))
            .with_context(|| format!("reading {DIST}{path}"))
    })?;
    std::fs::write(to, html).with_context(|| format!("writing {}", to.display()))
}

/// `{"checkedAt": …, "documents": {path: document, …}}`, safe inside a
/// `<script>` element: `<` only occurs inside JSON strings, where `<`
/// means the same, so no `</script>` or `<!--` can end or derail the element.
fn snapshot_json(documents: &[(String, Vec<u8>)], checked_at: Option<String>) -> Result<String> {
    let mut json = format!(
        "{{\"checkedAt\":{},\"documents\":{{",
        serde_json::to_string(&checked_at)?
    );
    for (i, (path, document)) in documents.iter().enumerate() {
        if i > 0 {
            json.push(',');
        }
        json.push_str(&serde_json::to_string(path)?);
        json.push(':');
        json.push_str(std::str::from_utf8(document)?);
    }
    json.push_str("}}");
    Ok(json.replace('<', "\\u003c"))
}

/// Replaces every element of the built index.html that loads a file from
/// `/assets/` with the file's content, and puts the snapshot ahead of the
/// first one so the page's script finds it. `read` takes the path as written
/// in the page, such as "/assets/index-CH1jHogz.js".
fn inline_assets(
    index: &str,
    snapshot: &str,
    read: impl Fn(&str) -> Result<String>,
) -> Result<String> {
    const MARKER: &str = "\"/assets/";
    let mut html = String::with_capacity(index.len() + snapshot.len());
    let mut rest = index;
    let mut scripts = 0;
    let mut placed = false;
    while let Some(found) = rest.find(MARKER) {
        let start = rest[..found]
            .rfind('<')
            .ok_or_else(|| anyhow!("index.html: /assets/ outside a tag"))?;
        let path_start = found + 1;
        let path_len = rest[path_start..]
            .find('"')
            .ok_or_else(|| anyhow!("index.html: unclosed attribute"))?;
        let path = &rest[path_start..path_start + path_len];
        let tag = &rest[start..];
        let content = read(path)?;
        html.push_str(&rest[..start]);
        if !placed {
            html.push_str(&format!("<script>window.__KNICKS__={snapshot}</script>\n"));
            placed = true;
        }
        let end = if tag.starts_with("<script") {
            scripts += 1;
            // "</script" inside the code would end the element early; "<\/"
            // means the same to JavaScript in a string or a regular expression.
            html.push_str(&format!(
                "<script type=\"module\">{}</script>",
                content.replace("</script", "<\\/script")
            ));
            tag.find("</script>")
                .map(|i| i + "</script>".len())
                .ok_or_else(|| anyhow!("index.html: unclosed <script>"))?
        } else if tag.starts_with("<link") {
            if content.contains("</style") {
                bail!("{path} contains </style and can't be inlined");
            }
            html.push_str(&format!("<style>{content}</style>"));
            tag.find('>')
                .map(|i| i + 1)
                .ok_or_else(|| anyhow!("index.html: unclosed <link>"))?
        } else {
            bail!("index.html loads {path} in a way export doesn't know");
        };
        rest = &rest[start + end..];
    }
    if scripts == 0 {
        bail!("index.html loads no script from /assets/; run `npm run build` first");
    }
    html.push_str(rest);
    Ok(html)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_cannot_close_its_script_element() {
        let documents = vec![(
            "/api/report".to_string(),
            br#"{"name":"</script><b>"}"#.to_vec(),
        )];
        let json = snapshot_json(&documents, Some("2026-11-14T00:00:00Z".into())).unwrap();
        assert!(!json.contains('<'));
        let parsed: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed["checkedAt"], "2026-11-14T00:00:00Z");
        assert_eq!(parsed["documents"]["/api/report"]["name"], "</script><b>");
    }

    #[test]
    fn inlines_the_script_and_stylesheet_after_the_snapshot() {
        let index = "<head><title>T</title>\n  <script type=\"module\" crossorigin src=\"/assets/a.js\"></script>\n  <link rel=\"stylesheet\" crossorigin href=\"/assets/a.css\">\n</head><body></body>";
        let html = inline_assets(index, "{}", |path| {
            Ok(match path {
                "/assets/a.js" => "let s = \"</script>\";".to_string(),
                "/assets/a.css" => "body{}".to_string(),
                other => panic!("unexpected {other}"),
            })
        })
        .unwrap();
        assert_eq!(
            html,
            "<head><title>T</title>\n  <script>window.__KNICKS__={}</script>\n<script type=\"module\">let s = \"<\\/script>\";</script>\n  <style>body{}</style>\n</head><body></body>"
        );
        assert!(inline_assets("<body></body>", "{}", |_| Ok(String::new())).is_err());
    }
}
