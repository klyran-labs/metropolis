use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DecodedField {
    pub name: String,
    pub value: String,
    pub field_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalldataInspectionRequest {
    pub calldata: String,
    pub agent: String,
    pub target: String,
    pub msg_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CalldataInspectionResponse {
    pub selector: String,
    pub function_name: String,
    pub fields: Vec<DecodedField>,
    pub risk_level: String, // "nominal", "elevated", "critical"
    pub clear_signing_summary: String,
}

pub struct CalldataDecoder;

impl CalldataDecoder {
    pub fn inspect(req: &CalldataInspectionRequest) -> CalldataInspectionResponse {
        let clean_hex = req.calldata.trim().trim_start_matches("0x");
        if clean_hex.len() < 8 {
            return CalldataInspectionResponse {
                selector: "0x00000000".to_string(),
                function_name: "unknown_or_fallback".to_string(),
                fields: vec![],
                risk_level: "elevated".to_string(),
                clear_signing_summary: "Native value transfer or unparsed raw call".to_string(),
            };
        }

        let selector = format!("0x{}", &clean_hex[..8]);
        let data = &clean_hex[8..];

        match selector.to_lowercase().as_str() {
            "0xa9059cbb" => {
                // transfer(address to, uint256 amount)
                let to = if data.len() >= 64 {
                    format!("0x{}", &data[24..64])
                } else {
                    "unknown".to_string()
                };
                let amount = if data.len() >= 128 {
                    u128::from_str_radix(&data[64..128], 16).unwrap_or(0).to_string()
                } else {
                    "0".to_string()
                };

                CalldataInspectionResponse {
                    selector,
                    function_name: "transfer(address,uint256)".to_string(),
                    fields: vec![
                        DecodedField {
                            name: "recipient".to_string(),
                            value: to.clone(),
                            field_type: "address".to_string(),
                        },
                        DecodedField {
                            name: "amount".to_string(),
                            value: amount.clone(),
                            field_type: "uint256".to_string(),
                        },
                    ],
                    risk_level: "nominal".to_string(),
                    clear_signing_summary: format!("Disburse {} tokens to {}", amount, to),
                }
            }
            "0x095ea7b3" => {
                // approve(address spender, uint256 amount)
                let spender = if data.len() >= 64 {
                    format!("0x{}", &data[24..64])
                } else {
                    "unknown".to_string()
                };
                let is_unlimited = data.len() >= 128 && data[64..128].chars().all(|c| c == 'f' || c == 'F');
                let risk = if is_unlimited { "critical" } else { "elevated" };

                CalldataInspectionResponse {
                    selector,
                    function_name: "approve(address,uint256)".to_string(),
                    fields: vec![
                        DecodedField {
                            name: "spender".to_string(),
                            value: spender.clone(),
                            field_type: "address".to_string(),
                        },
                        DecodedField {
                            name: "allowance".to_string(),
                            value: if is_unlimited { "UNLIMITED (MAX_UINT)".to_string() } else { "limited".to_string() },
                            field_type: "uint256".to_string(),
                        },
                    ],
                    risk_level: risk.to_string(),
                    clear_signing_summary: format!(
                        "Grant {} allowance to spender {}",
                        if is_unlimited { "UNLIMITED" } else { "scoped" },
                        spender
                    ),
                }
            }
            "0x23b872dd" => {
                // transferFrom(address from, address to, uint256 amount)
                let from = if data.len() >= 64 { format!("0x{}", &data[24..64]) } else { "unknown".to_string() };
                let to = if data.len() >= 128 { format!("0x{}", &data[88..128]) } else { "unknown".to_string() };

                CalldataInspectionResponse {
                    selector,
                    function_name: "transferFrom(address,address,uint256)".to_string(),
                    fields: vec![
                        DecodedField { name: "from".to_string(), value: from.clone(), field_type: "address".to_string() },
                        DecodedField { name: "to".to_string(), value: to.clone(), field_type: "address".to_string() },
                    ],
                    risk_level: "elevated".to_string(),
                    clear_signing_summary: format!("Delegated transfer from {} to {}", from, to),
                }
            }
            _ => {
                CalldataInspectionResponse {
                    selector,
                    function_name: "unrecognized_custom_function".to_string(),
                    fields: vec![],
                    risk_level: "elevated".to_string(),
                    clear_signing_summary: "Custom external contract invocation".to_string(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_transfer() {
        let req = CalldataInspectionRequest {
            calldata: "0xa9059cbb00000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000005f5e100".to_string(),
            agent: "0xAgent".to_string(),
            target: "0xToken".to_string(),
            msg_value: None,
        };

        let res = CalldataDecoder::inspect(&req);
        assert_eq!(res.selector, "0xa9059cbb");
        assert_eq!(res.risk_level, "nominal");
        assert_eq!(res.fields.len(), 2);
        assert!(res.clear_signing_summary.contains("Disburse 100000000 tokens"));
    }

    #[test]
    fn test_decode_unlimited_approve_flags_critical() {
        let req = CalldataInspectionRequest {
            calldata: "0x095ea7b30000000000000000000000002222222222222222222222222222222222222222ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff".to_string(),
            agent: "0xAgent".to_string(),
            target: "0xToken".to_string(),
            msg_value: None,
        };

        let res = CalldataDecoder::inspect(&req);
        assert_eq!(res.selector, "0x095ea7b3");
        assert_eq!(res.risk_level, "critical");
        assert!(res.clear_signing_summary.contains("UNLIMITED"));
    }
}
