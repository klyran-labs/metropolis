use alloy::primitives::{Address, B256, PrimitiveSignature, U256, keccak256};
use alloy::sol_types::SolValue;
use std::str::FromStr;

use crate::types::{SpendRequest, SpendRequestWire, X402AuthorizationPayload};

/// Computes the EIP-712 Domain Separator matching AgentWalletGuard.sol exactly
pub fn compute_domain_separator(chain_id: u64, verifying_contract: Address) -> B256 {
    let domain_typehash = keccak256(
        b"EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)",
    );
    let name_hash = keccak256(b"AgentGuard_PolicyEngine");
    let version_hash = keccak256(b"1");
    let chain_id_u256 = U256::from(chain_id);

    let encoded = (
        domain_typehash,
        name_hash,
        version_hash,
        chain_id_u256,
        verifying_contract,
    )
        .abi_encode();

    keccak256(encoded)
}

/// Computes the EIP-712 Struct Hash for a SpendRequest
pub fn compute_spend_request_hash(req: &SpendRequest) -> B256 {
    let spend_request_typehash = keccak256(
        b"SpendRequest(address agent,address merchant,uint256 amount,bytes32 category,uint256 timestamp,uint256 deadline,uint64 nonce)",
    );
    let encoded = (
        spend_request_typehash,
        req.agent,
        req.merchant,
        req.amount,
        req.category,
        req.timestamp,
        req.deadline,
        req.nonce,
    )
        .abi_encode();

    keccak256(encoded)
}

/// Computes the EIP-712 signing digest: keccak256("\x19\x01" || domainSeparator || structHash)
pub fn compute_eip712_digest(domain_separator: B256, struct_hash: B256) -> B256 {
    let mut message = Vec::with_capacity(2 + 32 + 32);
    message.extend_from_slice(&[0x19, 0x01]);
    message.extend_from_slice(domain_separator.as_slice());
    message.extend_from_slice(struct_hash.as_slice());
    keccak256(&message)
}

/// Parses a 65-byte or 64-byte signature into an Alloy `PrimitiveSignature`
pub fn parse_signature(sig_bytes: &[u8]) -> Result<PrimitiveSignature, String> {
    if sig_bytes.len() != 65 {
        return Err(format!(
            "Invalid signature length: expected 65 bytes, got {}",
            sig_bytes.len()
        ));
    }

    let r = B256::from_slice(&sig_bytes[0..32]);
    let s = B256::from_slice(&sig_bytes[32..64]);
    let v = sig_bytes[64];

    // Normalize v: 27/28 -> true/false, or 0/1 -> false/true
    let parity = match v {
        27 => false,
        28 => true,
        0 => false,
        1 => true,
        _ => return Err(format!("Invalid signature recovery id (v): {}", v)),
    };

    Ok(PrimitiveSignature::from_scalars_and_parity(r, s, parity))
}

/// Recovers the signer address from an EIP-712 digest and signature
pub fn recover_signer(digest: B256, sig_bytes: &[u8]) -> Result<Address, String> {
    let signature = parse_signature(sig_bytes)?;
    signature
        .recover_address_from_prehash(&digest)
        .map_err(|e| format!("Signature recovery failed: {}", e))
}

/// Parses the Authorization header (supports "x402 <base64>" or raw JSON base64)
pub fn parse_x402_authorization_header(
    auth_header: &str,
) -> Result<(SpendRequest, Vec<u8>), String> {
    let raw = auth_header.trim();
    let encoded = if let Some(stripped) = raw.strip_prefix("x402 ") {
        stripped.trim()
    } else if let Some(stripped) = raw.strip_prefix("Bearer ") {
        stripped.trim()
    } else {
        raw
    };

    use base64::Engine;
    use base64::engine::general_purpose::STANDARD as BASE64;

    // Decode base64
    let json_bytes = BASE64
        .decode(encoded.as_bytes())
        .map_err(|e| format!("Base64 decoding of x402 header failed: {}", e))?;

    let payload: X402AuthorizationPayload = serde_json::from_slice(&json_bytes)
        .map_err(|e| format!("JSON parsing of x402 payload failed: {}", e))?;

    let req = parse_spend_request_wire(&payload.request)?;

    let clean_sig = payload
        .signature
        .trim()
        .strip_prefix("0x")
        .unwrap_or(&payload.signature);
    let sig_bytes =
        hex::decode(clean_sig).map_err(|e| format!("Hex decoding of signature failed: {}", e))?;

    Ok((req, sig_bytes))
}

/// Converts SpendRequestWire to SpendRequest
pub fn parse_spend_request_wire(wire: &SpendRequestWire) -> Result<SpendRequest, String> {
    let agent = Address::from_str(&wire.agent)
        .map_err(|e| format!("Invalid agent address '{}': {}", wire.agent, e))?;
    let merchant = Address::from_str(&wire.merchant)
        .map_err(|e| format!("Invalid merchant address '{}': {}", wire.merchant, e))?;

    let amount = U256::from_str(&wire.amount)
        .map_err(|e| format!("Invalid amount '{}': {}", wire.amount, e))?;

    let clean_cat = wire
        .category
        .trim()
        .strip_prefix("0x")
        .unwrap_or(&wire.category);
    let category = if clean_cat.len() == 64 {
        B256::from_str(clean_cat)
            .map_err(|e| format!("Invalid category hash '{}': {}", wire.category, e))?
    } else {
        // Fallback: keccak256 hash the category string
        keccak256(wire.category.as_bytes())
    };

    let timestamp = U256::from_str(&wire.timestamp)
        .map_err(|e| format!("Invalid timestamp '{}': {}", wire.timestamp, e))?;
    let deadline = U256::from_str(&wire.deadline)
        .map_err(|e| format!("Invalid deadline '{}': {}", wire.deadline, e))?;
    let nonce = U256::from_str(&wire.nonce)
        .map_err(|e| format!("Invalid nonce '{}': {}", wire.nonce, e))?;

    Ok(SpendRequest {
        agent,
        merchant,
        amount,
        category,
        timestamp,
        deadline,
        nonce,
    })
}
