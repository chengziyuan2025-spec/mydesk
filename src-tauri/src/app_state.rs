use std::sync::Mutex;

#[derive(Default)]
pub struct DataState(pub Mutex<()>);

#[derive(Default)]
pub struct RuntimeStatus(pub Mutex<Option<String>>);
