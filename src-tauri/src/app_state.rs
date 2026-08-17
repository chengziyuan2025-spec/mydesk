use crate::{models::AppData, storage, AppError};
use serde::Serialize;
use std::{collections::BTreeMap, sync::Mutex, time::{Duration, Instant}};
use tauri::{AppHandle, Manager};

#[derive(Default)]
struct PersistState {
    target_revision: u64,
    persisted_revision: u64,
    scheduled: bool,
    last_change: Option<Instant>,
}

#[derive(Default)]
pub struct DataState {
    data: Mutex<Option<AppData>>,
    persist: Mutex<PersistState>,
}

impl DataState {
    pub fn read(&self, app: &AppHandle) -> Result<AppData, AppError> {
        let mut guard = self.data.lock().map_err(|_| AppError::Message("数据状态不可用".into()))?;
        if guard.is_none() {
            *guard = Some(storage::load(&storage::data_path(app)?)?);
        }
        Ok(guard.as_ref().expect("data initialized").clone())
    }

    pub fn mutate<T>(&self, app: &AppHandle, update: impl FnOnce(&mut AppData) -> Result<T, AppError>) -> Result<(AppData, T), AppError> {
        let (snapshot, result) = {
            let mut guard = self.data.lock().map_err(|_| AppError::Message("数据状态不可用".into()))?;
            if guard.is_none() {
                *guard = Some(storage::load(&storage::data_path(app)?)?);
            }
            let data = guard.as_mut().expect("data initialized");
            let result = update(data)?;
            (data.clone(), result)
        };
        self.schedule_persist(app, snapshot.revision);
        Ok((snapshot, result))
    }

    pub fn replace(&self, app: &AppHandle, data: AppData) -> Result<(), AppError> {
        let revision = data.revision;
        *self.data.lock().map_err(|_| AppError::Message("数据状态不可用".into()))? = Some(data);
        self.schedule_persist(app, revision);
        Ok(())
    }

    pub fn flush(&self, app: &AppHandle) -> Result<(), AppError> {
        let started = Instant::now();
        let data = self.read(app)?;
        let path = storage::data_path(app)?;
        storage::ensure_daily_backup(&path)?;
        storage::save(&path, &data)?;
        if let Ok(mut persist) = self.persist.lock() {
            persist.persisted_revision = persist.persisted_revision.max(data.revision);
            persist.target_revision = persist.target_revision.max(data.revision);
        }
        #[cfg(debug_assertions)]
        eprintln!("[deskbox:perf] data flush revision={} total={}ms", data.revision, started.elapsed().as_millis());
        Ok(())
    }

    fn schedule_persist(&self, app: &AppHandle, revision: u64) {
        let should_spawn = match self.persist.lock() {
            Ok(mut persist) => {
                persist.target_revision = persist.target_revision.max(revision);
                persist.last_change = Some(Instant::now());
                if persist.scheduled { false } else { persist.scheduled = true; true }
            }
            Err(_) => false,
        };
        if !should_spawn { return; }

        let app = app.clone();
        std::thread::spawn(move || {
            loop {
                let state = app.state::<DataState>();
                let wait_for = match state.persist.lock() {
                    Ok(persist) if persist.target_revision > persist.persisted_revision => {
                        persist
                            .last_change
                            .map(|change| Duration::from_millis(300).saturating_sub(change.elapsed()))
                            .unwrap_or_default()
                    }
                    Ok(mut persist) => { persist.scheduled = false; return; }
                    Err(_) => return,
                };
                if !wait_for.is_zero() {
                    std::thread::sleep(wait_for);
                    continue;
                }
                let target = match state.persist.lock() {
                    Ok(persist) if persist.target_revision > persist.persisted_revision => persist.target_revision,
                    Ok(mut persist) => { persist.scheduled = false; return; }
                    Err(_) => return,
                };
                let data = match state.data.lock() {
                    Ok(data) => data.clone(),
                    Err(_) => None,
                };
                let Some(data) = data else { return; };
                let started = Instant::now();
                let result = (|| -> Result<(), AppError> {
                    let path = storage::data_path(&app)?;
                    storage::ensure_daily_backup(&path)?;
                    storage::save(&path, &data)
                })();

                match result {
                    Ok(()) => {
                        if let Ok(mut persist) = state.persist.lock() {
                            persist.persisted_revision = persist.persisted_revision.max(data.revision).max(target);
                            #[cfg(debug_assertions)]
                            eprintln!("[deskbox:perf] data persist revision={} serialize_write={}ms", data.revision, started.elapsed().as_millis());
                            if persist.target_revision <= target {
                                persist.scheduled = false;
                                return;
                            }
                        } else { return; }
                    }
                    Err(error) => {
                        eprintln!("DeskBox 数据延迟保存失败：{error}");
                        if let Ok(mut persist) = state.persist.lock() { persist.scheduled = false; }
                        return;
                    }
                }
            }
        });
    }
}

#[derive(Default)]
pub struct RuntimeStatus(pub Mutex<Option<String>>);

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HotkeyStatus {
    pub action: String,
    pub accelerator: Option<String>,
    pub state: String,
    pub message: Option<String>,
}

#[derive(Default)]
pub struct HotkeyRuntime(pub Mutex<BTreeMap<String, HotkeyStatus>>);
