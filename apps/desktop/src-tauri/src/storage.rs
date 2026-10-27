use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

pub const SCHEMA_VERSION: u64 = 1;
const MAX_BLUEPRINT_BYTES: u64 = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum BlueprintScope {
    Builtin,
    User,
}

impl BlueprintScope {
    fn directory(self) -> &'static str {
        match self {
            Self::Builtin => "builtin",
            Self::User => "user",
        }
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredBlueprint {
    pub scope: BlueprintScope,
    pub id: String,
    pub name: String,
    pub revision: String,
    pub document: Option<Value>,
    pub error: Option<String>,
    pub runnable: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlueprintIndex {
    pub blueprints: Vec<StoredBlueprint>,
    pub diagnostics: Vec<String>,
}

#[derive(Clone)]
pub struct BlueprintStore {
    root: PathBuf,
}

impl BlueprintStore {
    pub fn beside_executable() -> Result<Self, String> {
        let executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let root = executable
            .parent()
            .ok_or_else(|| "Cannot locate the application directory".to_string())?
            .join("blueprints");
        Ok(Self { root })
    }

    #[cfg(test)]
    fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn path(&self, scope: BlueprintScope, id: &str) -> Result<PathBuf, String> {
        if !valid_id(id) {
            return Err("Blueprint ID may contain only letters, numbers, hyphens, and underscores".into());
        }
        Ok(self.root.join(scope.directory()).join(format!("{id}.nodrec.json")))
    }

    pub fn list(&self) -> BlueprintIndex {
        let mut blueprints = Vec::new();
        let mut diagnostics = Vec::new();
        for scope in [BlueprintScope::Builtin, BlueprintScope::User] {
            let directory = self.root.join(scope.directory());
            let entries = match fs::read_dir(&directory) {
                Ok(entries) => entries,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
                Err(error) => {
                    diagnostics.push(format!("Cannot read {}: {error}", directory.display()));
                    continue;
                }
            };
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        diagnostics.push(format!("Cannot read a blueprint entry: {error}"));
                        continue;
                    }
                };
                let path = entry.path();
                if entry.file_type().map(|kind| !kind.is_file()).unwrap_or(true)
                    || !path.file_name().and_then(|name| name.to_str()).is_some_and(|name| name.ends_with(".nodrec.json"))
                {
                    continue;
                }
                let filename_id = path.file_name().and_then(|name| name.to_str()).unwrap_or_default()
                    .trim_end_matches(".nodrec.json").to_string();
                let result = read_blueprint(scope, &filename_id, &path);
                if let Some(error) = &result.error {
                    diagnostics.push(format!("{}: {error}", path.display()));
                }
                blueprints.push(result);
            }
        }
        blueprints.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()).then(a.id.cmp(&b.id)));
        BlueprintIndex { blueprints, diagnostics }
    }

    pub fn save(
        &self,
        scope: BlueprintScope,
        id: &str,
        document: Value,
        expected_revision: Option<String>,
    ) -> Result<String, String> {
        if !valid_id(id) || document.get("id").and_then(Value::as_str) != Some(id) {
            return Err("Blueprint ID does not match the destination filename".into());
        }
        if document.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
            return Err("Unsupported blueprint schema version".into());
        }
        if document.get("name").and_then(Value::as_str).is_none_or(str::is_empty) {
            return Err("Blueprint name cannot be empty".into());
        }
        let path = self.path(scope, id)?;
        let other_scope = match scope {
            BlueprintScope::Builtin => BlueprintScope::User,
            BlueprintScope::User => BlueprintScope::Builtin,
        };
        if self.path(other_scope, id)?.exists() {
            return Err(format!("A blueprint with ID '{id}' already exists in {} storage", other_scope.directory()));
        }
        match (expected_revision, fs::read(&path)) {
            (Some(expected), Ok(bytes)) if revision(&bytes) == expected => {}
            (Some(_), Ok(_)) => return Err("Blueprint changed on disk; reload before saving".into()),
            (Some(_), Err(error)) => return Err(format!("Cannot verify the saved blueprint: {error}")),
            (None, Ok(_)) => return Err("A blueprint with this ID already exists".into()),
            (None, Err(error)) if error.kind() != std::io::ErrorKind::NotFound => {
                return Err(format!("Cannot inspect the destination: {error}"));
            }
            (None, Err(_)) => {}
        }
        fs::create_dir_all(path.parent().expect("blueprint path has a parent"))
            .map_err(|error| format!("Cannot create blueprint directory: {error}"))?;
        let bytes = serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?;
        if bytes.len() as u64 > MAX_BLUEPRINT_BYTES { return Err("Blueprint file exceeds the 16 MB limit".into()); }
        atomic_write(&path, &bytes)?;
        Ok(revision(&bytes))
    }

    pub fn delete(&self, scope: BlueprintScope, id: &str) -> Result<String, String> {
        let path = self.path(scope, id)?;
        let trash = self.root.join(".trash");
        fs::create_dir_all(&trash).map_err(|error| format!("Cannot create recovery directory: {error}"))?;
        let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
        let trash_name = format!("{id}-{stamp}.nodrec.json");
        fs::rename(&path, trash.join(&trash_name)).map_err(|error| format!("Cannot delete blueprint: {error}"))?;
        Ok(trash_name)
    }

    pub fn restore(&self, scope: BlueprintScope, id: &str, trash_name: &str) -> Result<(), String> {
        let path = self.path(scope, id)?;
        if Path::new(trash_name).file_name().and_then(|name| name.to_str()) != Some(trash_name)
            || !trash_name.starts_with(&format!("{id}-"))
            || !trash_name.ends_with(".nodrec.json")
        {
            return Err("Invalid blueprint recovery token".into());
        }
        if path.exists() {
            return Err("Cannot restore because a blueprint with this ID already exists".into());
        }
        fs::rename(self.root.join(".trash").join(trash_name), path)
            .map_err(|error| format!("Cannot restore blueprint: {error}"))
    }
}

fn read_blueprint(scope: BlueprintScope, filename_id: &str, path: &Path) -> StoredBlueprint {
    let mut stored = StoredBlueprint {
        scope,
        id: filename_id.to_string(),
        name: filename_id.to_string(),
        revision: "0".into(),
        document: None,
        error: None,
        runnable: false,
    };
    let size = match fs::metadata(path) {
        Ok(metadata) => metadata.len(),
        Err(error) => {
            stored.error = Some(format!("Cannot inspect blueprint: {error}"));
            return stored;
        }
    };
    if size > MAX_BLUEPRINT_BYTES {
        stored.error = Some("Blueprint file exceeds the 16 MB limit".into());
        return stored;
    }
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) => {
            stored.error = Some(format!("Cannot read blueprint: {error}"));
            return stored;
        }
    };
    stored.revision = revision(&bytes);
    let document: Value = match serde_json::from_slice(&bytes) {
        Ok(document) => document,
        Err(error) => {
            stored.error = Some(format!("Invalid JSON: {error}"));
            return stored;
        }
    };
    stored.name = document.get("name").and_then(Value::as_str).unwrap_or(filename_id).to_string();
    if document.get("id").and_then(Value::as_str) != Some(filename_id) {
        stored.error = Some("Blueprint ID does not match its filename".into());
    } else if document.get("schemaVersion").and_then(Value::as_u64) != Some(SCHEMA_VERSION) {
        stored.error = Some("Unsupported blueprint schema version".into());
    } else if stored.name.trim().is_empty() {
        stored.error = Some("Blueprint name cannot be empty".into());
    } else if !["nodes", "edges", "cards", "eventFolders", "events", "functionFolders", "functions", "variableFolders", "customParameters"].iter().all(|key| document.get(key).is_some_and(Value::is_array))
        || !["values", "labels", "layouts", "overviewLayouts"].iter().all(|key| document.get(key).is_some_and(Value::is_object))
    {
        stored.error = Some("Blueprint is missing required data fields".into());
    } else {
        stored.runnable = document.get("supported").and_then(Value::as_bool).unwrap_or(true);
    }
    stored.document = Some(document);
    stored
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 96 && id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

fn revision(bytes: &[u8]) -> String {
    let hash = bytes.iter().fold(0xcbf29ce484222325, |hash, byte| (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3));
    format!("{hash:016x}")
}

pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temp = path.with_extension(format!("tmp-{}-{stamp}", std::process::id()));
    let result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)
            .map_err(|error| format!("Cannot create temporary blueprint: {error}"))?;
        file.write_all(bytes).and_then(|()| file.sync_all())
            .map_err(|error| format!("Cannot write blueprint: {error}"))?;
        replace_file(&temp, path).map_err(|error| format!("Cannot replace blueprint: {error}"))
    })();
    if result.is_err() { let _ = fs::remove_file(temp); }
    result?;
    Ok(())
}

#[cfg(windows)]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let from: Vec<u16> = from.as_os_str().encode_wide().chain(Some(0)).collect();
    let to: Vec<u16> = to.as_os_str().encode_wide().chain(Some(0)).collect();
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }
    // Replace atomically so a failed save never leaves a partial or missing blueprint.
    let ok = unsafe { MoveFileExW(from.as_ptr(), to.as_ptr(), 0x1 | 0x8) };
    if ok == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
fn replace_file(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::rename(from, to)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_store() -> (BlueprintStore, PathBuf) {
        let path = std::env::temp_dir().join(format!("nodrec-blueprints-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        (BlueprintStore::new(path.clone()), path)
    }

    fn document(id: &str, name: &str) -> Value {
        json!({
            "schemaVersion": 1, "id": id, "name": name, "supported": true,
            "nodes": [], "edges": [], "cards": [], "eventFolders": [], "events": [],
            "functionFolders": [], "functions": [], "variableFolders": [], "customParameters": [],
            "values": {}, "labels": {}, "layouts": {}, "overviewLayouts": {}
        })
    }

    #[test]
    fn missing_directories_are_not_created_and_files_round_trip() {
        let (store, root) = temp_store();
        assert!(store.list().blueprints.is_empty());
        assert!(!root.exists());
        let saved = store.save(BlueprintScope::Builtin, "capture", document("capture", "Capture"), None).unwrap();
        let entry = store.list().blueprints.pop().unwrap();
        assert_eq!(entry.revision, saved);
        assert!(entry.runnable);
        assert_eq!(entry.document.unwrap()["name"], "Capture");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_edit_is_rejected_and_old_file_survives() {
        let (store, root) = temp_store();
        let revision = store.save(BlueprintScope::User, "capture", document("capture", "Old"), None).unwrap();
        store.save(BlueprintScope::User, "capture", document("capture", "External"), Some(revision.clone())).unwrap();
        assert!(store.save(BlueprintScope::User, "capture", document("capture", "Stale"), Some(revision)).is_err());
        assert_eq!(store.list().blueprints[0].document.as_ref().unwrap()["name"], "External");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deleted_blueprints_are_recoverable_without_startup_resurrection() {
        let (store, root) = temp_store();
        store.save(BlueprintScope::Builtin, "capture", document("capture", "Capture"), None).unwrap();
        let token = store.delete(BlueprintScope::Builtin, "capture").unwrap();
        assert!(store.list().blueprints.is_empty());
        assert!(!root.join("builtin").join("capture.nodrec.json").exists());
        store.restore(BlueprintScope::Builtin, "capture", &token).unwrap();
        assert_eq!(store.list().blueprints.len(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unsafe_ids_and_mismatched_documents_are_rejected() {
        let (store, root) = temp_store();
        assert!(store.save(BlueprintScope::User, "../escape", document("../escape", "x"), None).is_err());
        assert!(store.save(BlueprintScope::User, "safe", document("other", "x"), None).is_err());
        assert!(!root.exists());
    }
}
