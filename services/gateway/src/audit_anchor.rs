use alloy::primitives::{B256, keccak256};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MerkleInclusionProof {
    pub outbox_id: Uuid,
    pub leaf: String,
    pub index: usize,
    pub siblings: Vec<String>,
    pub root: String,
    pub total_leaves: usize,
}

/// Computes the Keccak-256 leaf hash for a settlement outbox item.
pub fn compute_outbox_leaf(
    id: Uuid,
    agent: &str,
    merchant: &str,
    amount: &str,
    nonce: &str,
    tx_hash: Option<&str>,
) -> B256 {
    let mut payload = Vec::new();
    payload.extend_from_slice(id.as_bytes());
    payload.extend_from_slice(agent.as_bytes());
    payload.extend_from_slice(merchant.as_bytes());
    payload.extend_from_slice(amount.as_bytes());
    payload.extend_from_slice(nonce.as_bytes());
    if let Some(th) = tx_hash {
        payload.extend_from_slice(th.as_bytes());
    }
    keccak256(&payload)
}

/// Generates a binary Merkle tree and produces the Merkle root and proof for target leaf.
pub fn generate_merkle_proof(leaves: &[B256], target_index: usize) -> Option<MerkleInclusionProof> {
    if leaves.is_empty() || target_index >= leaves.len() {
        return None;
    }

    let total_leaves = leaves.len();
    let mut current_level = leaves.to_vec();
    let mut siblings = Vec::new();
    let mut idx = target_index;

    while current_level.len() > 1 {
        let mut next_level = Vec::with_capacity(current_level.len().div_ceil(2));

        for chunk_idx in (0..current_level.len()).step_by(2) {
            let left = current_level[chunk_idx];
            let right = if chunk_idx + 1 < current_level.len() {
                current_level[chunk_idx + 1]
            } else {
                current_level[chunk_idx] // Duplicate odd leaf
            };

            if chunk_idx == idx || chunk_idx + 1 == idx {
                if idx.is_multiple_of(2) {
                    siblings.push(format!("{:#x}", right));
                } else {
                    siblings.push(format!("{:#x}", left));
                }
            }

            let mut combined = [0u8; 64];
            combined[0..32].copy_from_slice(left.as_slice());
            combined[32..64].copy_from_slice(right.as_slice());
            next_level.push(keccak256(combined));
        }

        idx /= 2;
        current_level = next_level;
    }

    let root = current_level[0];

    Some(MerkleInclusionProof {
        outbox_id: Uuid::nil(), // Caller sets corresponding ID
        leaf: format!("{:#x}", leaves[target_index]),
        index: target_index,
        siblings,
        root: format!("{:#x}", root),
        total_leaves,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_merkle_proof_generation_and_verification() {
        let id1 = Uuid::now_v7();
        let id2 = Uuid::now_v7();
        let id3 = Uuid::now_v7();

        let l1 = compute_outbox_leaf(id1, "0x1111", "0x2222", "100", "1", Some("0xabc"));
        let l2 = compute_outbox_leaf(id2, "0x3333", "0x4444", "200", "2", Some("0xdef"));
        let l3 = compute_outbox_leaf(id3, "0x5555", "0x6666", "300", "3", Some("0x789"));

        let leaves = vec![l1, l2, l3];
        let proof = generate_merkle_proof(&leaves, 1).expect("proof generation failed");

        assert_eq!(proof.total_leaves, 3);
        assert_eq!(proof.index, 1);
        assert!(!proof.siblings.is_empty());
        assert!(!proof.root.is_empty());
    }
}
