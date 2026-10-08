// Fase 2: janela com abas + sidecar Node.
// No boot: se nenhum manager responder (4400/4490), o Tauri lança
// `node src/cli/serve.js manager --no-open` como processo filho e o encerra
// quando o app fecha. O shell (ui/index.html) sonda as mesmas portas.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::TcpStream;
use std::path::PathBuf;
use std::process::{Child, Command};

const PORTS: [u16; 2] = [4400, 4490];

fn manager_up() -> bool {
    PORTS.iter().any(|p| TcpStream::connect(("127.0.0.1", *p)).is_ok())
}

/// Walk up from the exe (and cwd as fallback) until we find the repo root
/// (the dir containing src/cli/serve.js). Dev layout: the exe lives in
/// <repo>/desktop/src-tauri/target/{debug,release}/.
fn find_repo_root() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        candidates.extend(exe.ancestors().skip(1).map(PathBuf::from));
    }
    if let Ok(cwd) = std::env::current_dir() {
        candidates.extend(cwd.ancestors().map(PathBuf::from));
    }
    candidates
        .into_iter()
        .find(|d| d.join("src").join("cli").join("serve.js").is_file())
}

fn spawn_manager() -> Option<Child> {
    let root = find_repo_root()?;
    let serve = root.join("src").join("cli").join("serve.js");
    Command::new("node")
        .arg(&serve)
        .arg("manager")
        .arg("--no-open")
        .current_dir(&root)
        .spawn()
        .ok()
}

fn main() {
    let child = if manager_up() {
        None // already running (e.g. the user's own `spec-space manager`) — reuse it
    } else {
        spawn_manager()
    };

    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao rodar spec-space desktop");

    // window closed → tear the sidecar down with the app
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
}
