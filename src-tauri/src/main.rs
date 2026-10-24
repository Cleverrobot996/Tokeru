#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai;
mod commands;
mod db;
mod fonts;
mod grading;
mod mcp;
mod models;
mod repo;

use std::path::{Path, PathBuf};
use tauri::Manager;

fn boxed(e: String) -> Box<dyn std::error::Error> {
    Box::new(std::io::Error::new(std::io::ErrorKind::Other, e))
}

fn exe_dir() -> Option<PathBuf> {
    std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf))
}

/* 覆盖安装时若旧版仍在运行，安装器会把旧 exe 改名为 tokero.exe.oldN。
   旧进程退出后残留的备份不应一直占着 16 MB；下次启动顺手清掉。 */
fn cleanup_old_binaries() {
    let Some(dir) = exe_dir() else { return };
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let n = name.to_string_lossy().to_string();
        if n.starts_with("tokero.exe.old") || n.starts_with("tokeru.exe.old") {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

/* 启动失败时留一份日志在 exe 旁边，并弹窗说明，避免「双击没反应」。 */
fn write_startup_log(msg: &str) -> Option<PathBuf> {
    let path = exe_dir()?.join("tokero-startup-error.log");
    let stamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let body = format!("[{stamp}] Tokeru 启动失败\n\n{msg}\n");
    std::fs::write(&path, body).ok().map(|_| path)
}

#[cfg(windows)]
fn show_startup_error(msg: &str) {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "user32")]
    extern "system" {
        fn MessageBoxW(hwnd: *mut core::ffi::c_void, text: *const u16, caption: *const u16, u_type: u32) -> i32;
    }
    let wide = |s: &str| -> Vec<u16> { std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect() };
    let text = wide(msg);
    let caption = wide("Tokeru 启动失败");
    unsafe {
        MessageBoxW(std::ptr::null_mut(), text.as_ptr(), caption.as_ptr(), 0x10);
    }
}

#[cfg(not(windows))]
fn show_startup_error(msg: &str) {
    eprintln!("Tokeru 启动失败: {msg}");
}

fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    cleanup_old_binaries();
    /* 数据目录候选链：系统数据目录 → LocalAppData → exe 同目录 data/ → 临时目录。
       便携版放在受控文件夹、只读目录或权限异常时，逐级回退，尽量让应用能开起来。 */
    let explicit = std::env::var_os("TOKERU_DATA_DIR").map(PathBuf::from);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = explicit.clone() {
        candidates.push(dir);
    } else {
        if let Ok(dir) = app.path().app_data_dir() {
            candidates.push(dir);
        }
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(local).join("com.tokero.app"));
        }
        if let Some(dir) = exe_dir() {
            candidates.push(dir.join("data"));
        }
        candidates.push(std::env::temp_dir().join("Tokeru").join("data"));
    }
    let mut errors: Vec<String> = Vec::new();
    let mut opened: Option<(db::Db, PathBuf)> = None;
    let mut used_index = 0usize;
    for (index, dir) in candidates.iter().enumerate() {
        match db::Db::open(dir) {
            Ok(db) => {
                used_index = index;
                opened = Some((db, dir.clone()));
                break;
            }
            Err(error) => {
                eprintln!("数据目录不可用（{}）：{error}", dir.display());
                errors.push(format!("{}：{error}", dir.display()));
            }
        }
    }
    let (db, data_dir) = match opened {
        Some(pair) => pair,
        None => {
            return Err(boxed(format!(
                "所有数据目录都不可用：\n{}",
                errors.join("\n")
            )))
        }
    };
    if used_index > 0 {
        let first = errors.first().cloned().unwrap_or_default();
        eprintln!("数据目录不可用（{first}）；已改用 {}", data_dir.display());
    }

    app.manage(db);
    app.manage(mcp::McpManager::new());
    let mut webview_dir = data_dir.join("webview").join(std::process::id().to_string());
    if std::fs::create_dir_all(&webview_dir).is_err() {
        /* 数据目录可写但 webview 子目录不行时，退到临时目录，不阻断启动。 */
        webview_dir = std::env::temp_dir().join("Tokeru").join("webview").join(std::process::id().to_string());
        std::fs::create_dir_all(&webview_dir)?;
    }
    let handle = app.handle().clone();
    tauri::async_runtime::spawn(async move { mcp::boot(handle).await; });

    tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::App("index.html".into()))
        .title("Tokeru")
        .inner_size(1440.0, 920.0)
        .min_inner_size(1080.0, 700.0)
        .data_directory(webview_dir)
        .disable_drag_drop_handler()
        .build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if let Err(error) = setup_app(app) {
                let message = error.to_string();
                let detail = match write_startup_log(&message) {
                    Some(path) => format!("{message}\n\n日志：{}", path.display()),
                    None => message,
                };
                show_startup_error(&detail);
                std::process::exit(1);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_sets,
            commands::get_set,
            commands::list_bank,
            commands::create_attempt,
            commands::resume_attempt,
            commands::get_attempt,
            commands::save_answer,
            commands::submit_attempt,
            commands::self_grade,
            commands::list_records,
            commands::delete_attempt,
            commands::list_mistakes,
            commands::collect_mistakes,
            commands::set_mistake_status,
            commands::get_settings,
            commands::save_settings,
            commands::ai_test,
            commands::ai_complete,
            commands::ai_explain,
            commands::ai_vision_segment,
            commands::ai_vision_ocr,
            mcp::mcp_status,
            mcp::mcp_configure,
            mcp::mcp_regenerate_token,
            commands::ai_plan_scores,
            commands::apply_score_plan,
            commands::ai_grade_attempt,
            commands::ai_organize_tags,
            commands::apply_tag_suggestions,
            commands::ai_classify,
            commands::update_question,
            commands::list_system_fonts,
            commands::rename_set,
            commands::update_set_tags,
            commands::delete_set,
            commands::list_tags,
            commands::delete_tag,
            commands::list_tag_groups,
            commands::create_tag_group,
            commands::rename_tag_group,
            commands::delete_tag_group,
            commands::assign_tag_group,
            commands::assign_tags_group,
            commands::list_folders,
            commands::create_folder,
            commands::rename_folder,
            commands::delete_folder,
            commands::assign_folder,
            commands::backup_now,
            commands::restore_backup,
            commands::preview_import,
            commands::confirm_import,
            commands::undo_import,
            commands::media_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running Tokeru");
}

fn main() {
    run();
}