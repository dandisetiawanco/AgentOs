use serde::Serialize;
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Serialize)]
pub struct BackendConnectionConfig {
    pub base_url: String,
    pub session_token: String,
    pub pid: Option<u32>,
    pub managed_by_tauri: bool,
}

#[derive(Default)]
struct BackendState {
    child: Option<Child>,
    config: Option<BackendConnectionConfig>,
}

pub struct BackendManager {
    state: Mutex<BackendState>,
}

impl BackendManager {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(BackendState::default()),
        }
    }

    pub fn ensure_started(
        &self,
        resource_dir: Option<PathBuf>,
    ) -> Result<BackendConnectionConfig, String> {
        let mut guard = self
            .state
            .lock()
            .map_err(|_| "Backend state lock poisoned".to_string())?;

        if let Some(child) = guard.child.as_mut() {
            if let Ok(None) = child.try_wait() {
                if let Some(cfg) = guard.config.clone() {
                    return Ok(cfg);
                }
            }
        }

        // Allow connecting to an already running dev backend only if explicitly provided via env.
        if let (Ok(external_url), Ok(external_token)) = (
            std::env::var("AGENTOS_EXTERNAL_BACKEND_URL"),
            std::env::var("AGENTOS_SESSION_TOKEN"),
        ) {
            if is_loopback_url(&external_url) && !external_token.trim().is_empty() {
                let cfg = BackendConnectionConfig {
                    base_url: external_url.trim_end_matches('/').to_string(),
                    session_token: external_token,
                    pid: None,
                    managed_by_tauri: false,
                };
                guard.config = Some(cfg.clone());
                return Ok(cfg);
            }
        }

        let port = allocate_loopback_port()?;
        let session_token = generate_session_token()?;
        let base_url = format!("http://127.0.0.1:{port}");

        let mut cmd = build_backend_command(port, &session_token, resource_dir.as_deref())?;
        let mut child = cmd
            .stdin(Stdio::null())
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .spawn()
            .map_err(|err| format!("Failed to start local AgentOS backend: {err}"))?;

        let pid = child.id();
        if let Err(err) = wait_for_health(&base_url, &mut child, Duration::from_secs(18)) {
            terminate_child(&mut child);
            return Err(err);
        }

        let cfg = BackendConnectionConfig {
            base_url,
            session_token,
            pid: Some(pid),
            managed_by_tauri: true,
        };
        guard.child = Some(child);
        guard.config = Some(cfg.clone());
        Ok(cfg)
    }

    pub fn restart(
        &self,
        resource_dir: Option<PathBuf>,
    ) -> Result<BackendConnectionConfig, String> {
        self.shutdown();
        self.ensure_started(resource_dir)
    }

    pub fn shutdown(&self) {
        if let Ok(mut guard) = self.state.lock() {
            if let Some(mut child) = guard.child.take() {
                terminate_child(&mut child);
            }
            guard.config = None;
        }
    }
}

pub fn allocate_loopback_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|err| format!("Failed to reserve localhost port: {err}"))?;
    let port = listener
        .local_addr()
        .map_err(|err| format!("Failed to inspect reserved localhost port: {err}"))?
        .port();
    drop(listener);
    Ok(port)
}

pub fn generate_session_token() -> Result<String, String> {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes)
        .map_err(|err| format!("Failed to generate cryptographic session token: {err}"))?;
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        hex.push_str(&format!("{byte:02x}"));
    }
    Ok(hex)
}

pub fn is_loopback_url(url: &str) -> bool {
    url.starts_with("http://127.0.0.1:") || url.starts_with("http://localhost:")
}

fn find_repo_backend_dir() -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd);
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            candidates.push(parent.to_path_buf());
        }
    }

    for start in candidates {
        let mut cursor = Some(start.as_path());
        while let Some(dir) = cursor {
            let backend_dir = dir.join("backend");
            if backend_dir.join("agentos").join("__main__.py").exists() {
                return Some(backend_dir);
            }
            cursor = dir.parent();
        }
    }
    None
}

fn build_backend_command(
    port: u16,
    session_token: &str,
    resource_dir: Option<&Path>,
) -> Result<Command, String> {
    if let Ok(custom_bin) = std::env::var("AGENTOS_BACKEND_BIN") {
        let path = PathBuf::from(custom_bin);
        if path.exists() {
            let mut cmd = Command::new(path);
            cmd.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
            cmd.env("AGENTOS_SESSION_TOKEN", session_token);
            return Ok(cmd);
        }
    }

    if let Some(res_dir) = resource_dir {
        let sidecar = res_dir.join("agentos-backend");
        if sidecar.exists() {
            let mut cmd = Command::new(sidecar);
            cmd.args(["--host", "127.0.0.1", "--port", &port.to_string()]);
            cmd.env("AGENTOS_SESSION_TOKEN", session_token);
            return Ok(cmd);
        }
    }

    if let Some(backend_dir) = find_repo_backend_dir() {
        let venv_python = if cfg!(windows) {
            backend_dir.join(".venv").join("Scripts").join("python.exe")
        } else {
            backend_dir.join(".venv").join("bin").join("python")
        };
        let python_bin = if venv_python.exists() {
            venv_python
        } else {
            PathBuf::from("python3")
        };
        let mut cmd = Command::new(python_bin);
        cmd.current_dir(&backend_dir);
        cmd.args([
            "-m",
            "agentos",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ]);
        cmd.env("AGENTOS_SESSION_TOKEN", session_token);
        cmd.env("PYTHONUNBUFFERED", "1");
        return Ok(cmd);
    }

    Err("Could not locate AgentOS Python backend runtime. Run 'uv sync' in backend/ or bundle the backend binary.".to_string())
}

fn wait_for_health(base_url: &str, child: &mut Child, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let health_url = format!("{base_url}/api/v1/health");
    let agent = ureq::AgentBuilder::new()
        .timeout(Duration::from_millis(800))
        .build();

    while Instant::now() < deadline {
        if let Ok(Some(status)) = child.try_wait() {
            return Err(format!(
                "Local backend exited unexpectedly during startup (status: {status})."
            ));
        }
        if let Ok(resp) = agent.get(&health_url).call() {
            if resp.status() == 200 {
                return Ok(());
            }
        }
        thread::sleep(Duration::from_millis(180));
    }

    Err(format!(
        "Timed out waiting for local AgentOS backend health check at {health_url}."
    ))
}

fn terminate_child(child: &mut Child) {
    #[cfg(unix)]
    {
        let pid = child.id() as libc::pid_t;
        // Send SIGTERM first so FastAPI/SQLite can flush WAL and close gracefully.
        unsafe {
            libc::kill(pid, libc::SIGTERM);
        }
        let deadline = Instant::now() + Duration::from_secs(4);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_64_hex_char_token() {
        let a = generate_session_token().expect("token a");
        let b = generate_session_token().expect("token b");
        assert_eq!(a.len(), 64);
        assert_ne!(a, b);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn reserves_valid_loopback_port() {
        let port = allocate_loopback_port().expect("port");
        assert!(port >= 1024);
    }

    #[test]
    fn validates_loopback_urls() {
        assert!(is_loopback_url("http://127.0.0.1:47821"));
        assert!(is_loopback_url("http://localhost:47821"));
        assert!(!is_loopback_url("http://0.0.0.0:47821"));
        assert!(!is_loopback_url("https://example.com"));
    }
}
