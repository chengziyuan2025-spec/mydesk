use serde::Serialize;
use std::{collections::BTreeMap, sync::Mutex};

#[derive(Default)]
pub struct DataState(pub Mutex<()>);

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
