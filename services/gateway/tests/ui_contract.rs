//! Guards `docs/api/ui-contract.json`, the published response contract for the web console.
//! It is generated from the gateway's own types; if a type changes the file must be regenerated:
//! `UPDATE_UI_CONTRACT=1 cargo test --test ui_contract`.

use agentguard_gateway::ui_contract::ui_contract;
use std::path::PathBuf;

fn contract_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../docs/api/ui-contract.json")
}

#[test]
fn published_contract_matches_gateway_types() {
    let generated = serde_json::to_string_pretty(&ui_contract()).expect("serialize") + "\n";
    let path = contract_path();
    if std::env::var("UPDATE_UI_CONTRACT").is_ok() {
        std::fs::write(&path, &generated).expect("write contract");
        return;
    }
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    assert!(
        committed == generated,
        "docs/api/ui-contract.json is out of date. Regenerate it with: UPDATE_UI_CONTRACT=1 cargo test --test ui_contract"
    );
}

#[test]
fn every_endpoint_has_an_object_or_array_schema() {
    let contract = ui_contract();
    let endpoints = contract["endpoints"].as_object().expect("endpoints");
    assert!(endpoints.len() >= 6);
    for (name, schema) in endpoints {
        let kind = &schema["type"];
        assert!(
            kind == "object" || kind == "array",
            "{name} must describe an object or array, got {kind}"
        );
    }
}
