pub struct Config {
    pub valkey_url: String,
    pub listen_addr: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            valkey_url: std::env::var("VALKEY_URL")
                .unwrap_or_else(|_| "redis://127.0.0.1:6379".into()),
            listen_addr: std::env::var("LISTEN_ADDR")
                .unwrap_or_else(|_| "0.0.0.0:3000".into()),
        }
    }
}
