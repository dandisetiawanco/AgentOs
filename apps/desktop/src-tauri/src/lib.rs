mod backend;

use backend::{BackendConnectionConfig, BackendManager};
use serde::Serialize;
use tauri::{Manager, RunEvent, State};

#[derive(Serialize)]
struct RuntimeInfo {
    os: &'static str,
    arch: &'static str,
    version: &'static str,
}

#[tauri::command]
fn get_backend_config(
    app: tauri::AppHandle,
    manager: State<'_, BackendManager>,
) -> Result<BackendConnectionConfig, String> {
    let res_dir = app.path().resource_dir().ok();
    manager.ensure_started(res_dir)
}

#[tauri::command]
fn restart_backend(
    app: tauri::AppHandle,
    manager: State<'_, BackendManager>,
) -> Result<BackendConnectionConfig, String> {
    let res_dir = app.path().resource_dir().ok();
    manager.restart(res_dir)
}

#[tauri::command]
fn get_runtime_info() -> RuntimeInfo {
    RuntimeInfo {
        os: std::env::consts::OS,
        arch: std::env::consts::ARCH,
        version: env!("CARGO_PKG_VERSION"),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let backend_manager = BackendManager::new();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(backend_manager)
        .setup(|app| {
            let manager = app.state::<BackendManager>();
            let res_dir = app.path().resource_dir().ok();
            // Start backend eagerly on launch; frontend can still query or retry on failure.
            if let Err(err) = manager.ensure_started(res_dir) {
                eprintln!("[AgentOS] Backend startup deferred/error: {err}");
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_backend_config,
            restart_backend,
            get_runtime_info
        ])
        .build(tauri::generate_context!())
        .expect("error while building AgentOS Tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
            let manager = app_handle.state::<BackendManager>();
            manager.shutdown();
        }
    });
}
