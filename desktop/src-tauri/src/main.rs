// Fase 1 (PoC): janela única apontando para o manager do spec-space.
// O manager roda manualmente (`spec-space manager` em outro terminal).
// Nas fases seguintes este main.rs ganha o sidecar Node.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erro ao rodar spec-space desktop");
}
