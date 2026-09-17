use crate::{
    abac::AbacPolicy,
    auth::{ApiKeyIdentity, OperatorIdentity},
    pbac::PbacPolicy,
};
use alloy::primitives::Address;
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Row, postgres::PgPool};

pub struct ChainEventRecord<'a> {
    pub chain_id: u64,
    pub block_number: u64,
    pub block_hash: &'a str,
    pub transaction_hash: &'a str,
    pub log_index: u64,
    pub event_name: &'a str,
    pub agent_address: Option<&'a str>,
    pub org_id: Option<&'a str>,
    pub payload: &'a Value,
    pub finalized: bool,
}

#[derive(Clone)]
pub struct PgRepository {
    pub pool: PgPool,
}

impl PgRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn load_api_key(
        &self,
        key_prefix: &str,
        key_hash: &[u8],
    ) -> Result<Option<ApiKeyIdentity>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT id, org_id, subject, agent_address, capabilities, expires_at, revoked_at
            FROM api_keys
            WHERE key_prefix = $1 AND key_hash = $2
            "#,
        )
        .bind(key_prefix)
        .bind(key_hash)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else { return Ok(None) };
        let expires_at: Option<DateTime<Utc>> = row.try_get("expires_at")?;
        let revoked_at: Option<DateTime<Utc>> = row.try_get("revoked_at")?;
        if revoked_at.is_some() || expires_at.is_some_and(|value| value <= Utc::now()) {
            return Ok(None);
        }

        let agent_address: String = row.try_get("agent_address")?;
        let agent = agent_address
            .parse::<Address>()
            .map_err(|error| sqlx::Error::Decode(Box::new(error)))?;
        let capabilities: Value = row.try_get("capabilities")?;
        let capabilities = capabilities
            .as_array()
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();

        Ok(Some(ApiKeyIdentity {
            id: row.try_get("id")?,
            org_id: row.try_get("org_id")?,
            subject: row.try_get("subject")?,
            agent,
            capabilities,
        }))
    }

    pub async fn load_operator(
        &self,
        org_id: &str,
        subject: &str,
    ) -> Result<Option<OperatorIdentity>, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT o.role, o.mfa_authenticated, org.enterprise_address
            FROM operators o
            JOIN organizations org ON org.org_id = o.org_id
            WHERE o.org_id = $1 AND o.subject = $2
              AND o.status = 'active' AND org.status = 'active'
            "#,
        )
        .bind(org_id)
        .bind(subject)
        .fetch_optional(&self.pool)
        .await?;

        let Some(row) = row else { return Ok(None) };
        let enterprise_address: String = row.try_get("enterprise_address")?;
        Ok(Some(OperatorIdentity {
            role: row.try_get("role")?,
            mfa_authenticated: row.try_get("mfa_authenticated")?,
            enterprise_address: enterprise_address
                .parse::<Address>()
                .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
        }))
    }

    pub async fn load_platform_role(&self, subject: &str) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT role FROM platform_operators WHERE subject = $1 AND status = 'active'",
        )
        .bind(subject)
        .fetch_optional(&self.pool)
        .await
    }

    pub async fn load_operator_for_subject(
        &self,
        subject: &str,
        org_hint: Option<&str>,
    ) -> Result<Option<(String, OperatorIdentity)>, sqlx::Error> {
        if let Some(org_id) = org_hint {
            return self
                .load_operator(org_id, subject)
                .await
                .map(|identity| identity.map(|identity| (org_id.to_owned(), identity)));
        }

        let rows = sqlx::query(
            r#"
            SELECT o.org_id, o.role, o.mfa_authenticated, org.enterprise_address
            FROM operators o
            JOIN organizations org ON org.org_id = o.org_id
            WHERE o.subject = $1 AND o.status = 'active' AND org.status = 'active'
            ORDER BY o.org_id
            LIMIT 2
            "#,
        )
        .bind(subject)
        .fetch_all(&self.pool)
        .await?;

        if rows.len() != 1 {
            return Ok(None);
        }
        let row = &rows[0];
        let enterprise_address: String = row.try_get("enterprise_address")?;
        Ok(Some((
            row.try_get("org_id")?,
            OperatorIdentity {
                role: row.try_get("role")?,
                mfa_authenticated: row.try_get("mfa_authenticated")?,
                enterprise_address: enterprise_address
                    .parse::<Address>()
                    .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
            },
        )))
    }

    pub async fn load_pbac_policies(&self, org_id: &str) -> Result<Vec<PbacPolicy>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            SELECT id, org_id, version, effect, principals, actions, resources, conditions
            FROM authorization_policies
            WHERE org_id = $1 AND active = TRUE
            ORDER BY version ASC, id ASC
            "#,
        )
        .bind(org_id)
        .fetch_all(&self.pool)
        .await?;

        rows.into_iter()
            .map(|row| {
                let principals: Value = row.try_get("principals")?;
                let actions: Value = row.try_get("actions")?;
                let resources: Value = row.try_get("resources")?;
                let conditions: Value = row.try_get("conditions")?;
                Ok(PbacPolicy {
                    id: row.try_get("id")?,
                    org_id: row.try_get("org_id")?,
                    version: row.try_get("version")?,
                    effect: match row.try_get::<String, _>("effect")?.as_str() {
                        "allow" => crate::pbac::PolicyEffect::Allow,
                        "deny" => crate::pbac::PolicyEffect::Deny,
                        other => {
                            return Err(sqlx::Error::Decode(
                                format!("unknown policy effect '{other}'").into(),
                            ));
                        }
                    },
                    principals: serde_json::from_value(principals)
                        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
                    actions: serde_json::from_value(actions)
                        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
                    resources: serde_json::from_value(resources)
                        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
                    conditions: serde_json::from_value(conditions)
                        .map_err(|error| sqlx::Error::Decode(Box::new(error)))?,
                })
            })
            .collect()
    }

    pub async fn load_abac_policy(&self, org_id: &str) -> Result<Option<AbacPolicy>, sqlx::Error> {
        let value: Option<Value> = sqlx::query_scalar(
            "SELECT attributes FROM tenant_policies WHERE org_id = $1 AND active = TRUE",
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;
        value
            .map(|value| {
                serde_json::from_value(value).map_err(|error| sqlx::Error::Decode(Box::new(error)))
            })
            .transpose()
    }

    pub async fn insert_chain_event(
        &self,
        event: ChainEventRecord<'_>,
    ) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            INSERT INTO chain_events
              (chain_id, block_number, block_hash, transaction_hash, log_index,
               event_name, agent_address, org_id, payload, finalized)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            ON CONFLICT (chain_id, transaction_hash, log_index) DO NOTHING
            "#,
        )
        .bind(event.chain_id as i64)
        .bind(event.block_number as i64)
        .bind(event.block_hash)
        .bind(event.transaction_hash)
        .bind(event.log_index as i64)
        .bind(event.event_name)
        .bind(event.agent_address)
        .bind(event.org_id)
        .bind(event.payload)
        .bind(event.finalized)
        .execute(&self.pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn mark_events_unfinalized_after(
        &self,
        chain_id: u64,
        block_number: u64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            "UPDATE chain_events SET finalized = FALSE WHERE chain_id = $1 AND block_number >= $2",
        )
        .bind(chain_id as i64)
        .bind(block_number as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn organization_for_agent(
        &self,
        agent_address: &str,
    ) -> Result<Option<String>, sqlx::Error> {
        sqlx::query_scalar(
            "SELECT org_id FROM agents WHERE agent_address = $1 AND status = 'active'",
        )
        .bind(agent_address)
        .fetch_optional(&self.pool)
        .await
    }

    /// Batch-resolves org_id for a set of agent addresses in a single SQL round-trip.
    ///
    /// Replaces the N+1 sequential `organization_for_agent` calls in the chain event
    /// polling loop. A 1,000-block batch typically contains 10-50 distinct agent
    /// addresses; resolving them individually adds 10-100ms of sequential DB latency
    /// per poll cycle. This single `ANY($1)` query completes in 1-2ms regardless of N.
    pub async fn organizations_for_agents(
        &self,
        agent_addresses: &[String],
    ) -> Result<std::collections::HashMap<String, String>, sqlx::Error> {
        if agent_addresses.is_empty() {
            return Ok(std::collections::HashMap::new());
        }
        let rows: Vec<(String, String)> = sqlx::query_as(
            "SELECT agent_address, org_id FROM agents \
             WHERE agent_address = ANY($1) AND status = 'active'",
        )
        .bind(agent_addresses)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.into_iter().collect())
    }

    pub async fn checkpoint(&self, chain_id: u64) -> Result<Option<(u64, String)>, sqlx::Error> {
        let row =
            sqlx::query("SELECT next_block, block_hash FROM event_checkpoints WHERE chain_id = $1")
                .bind(chain_id as i64)
                .fetch_optional(&self.pool)
                .await?;
        row.map(|row| {
            Ok((
                row.try_get::<i64, _>("next_block")? as u64,
                row.try_get("block_hash")?,
            ))
        })
        .transpose()
    }

    pub async fn save_checkpoint(
        &self,
        chain_id: u64,
        next_block: u64,
        block_hash: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            INSERT INTO event_checkpoints (chain_id, next_block, block_hash)
            VALUES ($1,$2,$3)
            ON CONFLICT (chain_id) DO UPDATE SET next_block = EXCLUDED.next_block, block_hash = EXCLUDED.block_hash
            "#,
        )
        .bind(chain_id as i64)
        .bind(next_block as i64)
        .bind(block_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[async_trait]
pub trait PolicyRepository: Send + Sync {
    async fn load_pbac_policies(&self, org_id: &str) -> Result<Vec<PbacPolicy>, sqlx::Error>;
    async fn load_abac_policy(&self, org_id: &str) -> Result<Option<AbacPolicy>, sqlx::Error>;
}

#[async_trait]
impl PolicyRepository for PgRepository {
    async fn load_pbac_policies(&self, org_id: &str) -> Result<Vec<PbacPolicy>, sqlx::Error> {
        self.load_pbac_policies(org_id).await
    }

    async fn load_abac_policy(&self, org_id: &str) -> Result<Option<AbacPolicy>, sqlx::Error> {
        self.load_abac_policy(org_id).await
    }
}

impl PgRepository {
    pub async fn load_tenant_pricing_model(
        &self,
        org_id: &str,
    ) -> Result<crate::types::TenantPricingModel, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT org_id, model_type, discount_bps, volume_tiers, ptu_capacity_tokens,
                   COALESCE(token_cap_tokens, 0) as token_cap_tokens,
                   COALESCE(per_call_fee_micro_dollars, 0) as per_call_fee_micro_dollars,
                   custom_rates,
                   COALESCE(tool_custom_rates, '{}'::jsonb) as tool_custom_rates,
                   monthly_tokens_consumed, updated_at
            FROM tenant_ai_pricing_models
            WHERE org_id = $1
            "#,
        )
        .bind(org_id)
        .fetch_optional(&self.pool)
        .await?;

        if let Some(row) = row {
            let model_type_str: String = row.try_get("model_type")?;
            let model_type = match model_type_str.as_str() {
                "tiered_volume" => crate::types::PricingModelType::TieredVolume,
                "committed_ptu" => crate::types::PricingModelType::CommittedPtu,
                "batch_discount" => crate::types::PricingModelType::BatchDiscount,
                "per_unit_request" => crate::types::PricingModelType::PerUnitRequest,
                "hybrid_commit_volume" => crate::types::PricingModelType::HybridCommitVolume,
                _ => crate::types::PricingModelType::FlatDiscount,
            };
            let discount_bps: i32 = row.try_get("discount_bps")?;
            let volume_tiers_val: serde_json::Value = row.try_get("volume_tiers")?;
            let ptu_capacity_tokens: i64 = row.try_get("ptu_capacity_tokens")?;
            let token_cap_tokens: i64 = row.try_get("token_cap_tokens").unwrap_or(0);
            let per_call_fee_micro_dollars: i64 = row.try_get("per_call_fee_micro_dollars").unwrap_or(0);
            let custom_rates_val: serde_json::Value = row.try_get("custom_rates")?;
            let tool_custom_rates_val: serde_json::Value = row.try_get("tool_custom_rates").unwrap_or_else(|_| serde_json::json!({}));
            let monthly_tokens_consumed: i64 = row.try_get("monthly_tokens_consumed")?;
            let updated_at: chrono::DateTime<chrono::Utc> = row.try_get("updated_at")?;

            let volume_tiers = serde_json::from_value(volume_tiers_val).unwrap_or_default();
            let custom_rates = serde_json::from_value(custom_rates_val).unwrap_or_default();
            let tool_custom_rates = serde_json::from_value(tool_custom_rates_val).unwrap_or_default();

            Ok(crate::types::TenantPricingModel {
                org_id: org_id.to_string(),
                model_type,
                discount_bps: discount_bps as u32,
                volume_tiers,
                ptu_capacity_tokens: ptu_capacity_tokens as u64,
                token_cap_tokens: token_cap_tokens as u64,
                per_call_fee_micro_dollars: per_call_fee_micro_dollars as u64,
                custom_rates,
                tool_custom_rates,
                monthly_tokens_consumed: monthly_tokens_consumed as u64,
                updated_at: updated_at.to_rfc3339(),
            })
        } else {
            // Standard default: flat 0% discount, zero consumed
            Ok(crate::types::TenantPricingModel {
                org_id: org_id.to_string(),
                model_type: crate::types::PricingModelType::FlatDiscount,
                discount_bps: 0,
                volume_tiers: vec![],
                ptu_capacity_tokens: 0,
                token_cap_tokens: 0,
                per_call_fee_micro_dollars: 0,
                custom_rates: std::collections::HashMap::new(),
                tool_custom_rates: std::collections::HashMap::new(),
                monthly_tokens_consumed: 0,
                updated_at: chrono::Utc::now().to_rfc3339(),
            })
        }
    }

    pub async fn upsert_tenant_pricing_model(
        &self,
        org_id: &str,
        req: &crate::types::UpdatePricingModelRequest,
    ) -> Result<crate::types::TenantPricingModel, sqlx::Error> {
        let model_type_str = match req.model_type {
            crate::types::PricingModelType::FlatDiscount => "flat_discount",
            crate::types::PricingModelType::TieredVolume => "tiered_volume",
            crate::types::PricingModelType::CommittedPtu => "committed_ptu",
            crate::types::PricingModelType::BatchDiscount => "batch_discount",
            crate::types::PricingModelType::PerUnitRequest => "per_unit_request",
            crate::types::PricingModelType::HybridCommitVolume => "hybrid_commit_volume",
        };
        let volume_tiers_val = serde_json::to_value(&req.volume_tiers).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        let custom_rates_val = serde_json::to_value(&req.custom_rates).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        let tool_custom_rates_val = serde_json::to_value(&req.tool_custom_rates).map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

        let row = sqlx::query(
            r#"
            INSERT INTO tenant_ai_pricing_models
                (org_id, model_type, discount_bps, volume_tiers, ptu_capacity_tokens, token_cap_tokens, per_call_fee_micro_dollars, custom_rates, tool_custom_rates, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
            ON CONFLICT (org_id) DO UPDATE SET
                model_type = EXCLUDED.model_type,
                discount_bps = EXCLUDED.discount_bps,
                volume_tiers = EXCLUDED.volume_tiers,
                ptu_capacity_tokens = EXCLUDED.ptu_capacity_tokens,
                token_cap_tokens = EXCLUDED.token_cap_tokens,
                per_call_fee_micro_dollars = EXCLUDED.per_call_fee_micro_dollars,
                custom_rates = EXCLUDED.custom_rates,
                tool_custom_rates = EXCLUDED.tool_custom_rates,
                updated_at = NOW()
            RETURNING org_id, model_type, discount_bps, volume_tiers, ptu_capacity_tokens, token_cap_tokens, per_call_fee_micro_dollars,
                      custom_rates, tool_custom_rates, monthly_tokens_consumed, updated_at
            "#,
        )
        .bind(org_id)
        .bind(model_type_str)
        .bind(req.discount_bps as i32)
        .bind(volume_tiers_val)
        .bind(req.ptu_capacity_tokens as i64)
        .bind(req.token_cap_tokens as i64)
        .bind(req.per_call_fee_micro_dollars as i64)
        .bind(custom_rates_val)
        .bind(tool_custom_rates_val)
        .fetch_one(&self.pool)
        .await?;

        let model_type_ret: String = row.try_get("model_type")?;
        let model_type = match model_type_ret.as_str() {
            "tiered_volume" => crate::types::PricingModelType::TieredVolume,
            "committed_ptu" => crate::types::PricingModelType::CommittedPtu,
            "batch_discount" => crate::types::PricingModelType::BatchDiscount,
            "per_unit_request" => crate::types::PricingModelType::PerUnitRequest,
            "hybrid_commit_volume" => crate::types::PricingModelType::HybridCommitVolume,
            _ => crate::types::PricingModelType::FlatDiscount,
        };
        let discount_bps: i32 = row.try_get("discount_bps")?;
        let volume_tiers_val: serde_json::Value = row.try_get("volume_tiers")?;
        let ptu_capacity_tokens: i64 = row.try_get("ptu_capacity_tokens")?;
        let token_cap_tokens: i64 = row.try_get("token_cap_tokens").unwrap_or(0);
        let per_call_fee_micro_dollars: i64 = row.try_get("per_call_fee_micro_dollars").unwrap_or(0);
        let custom_rates_val: serde_json::Value = row.try_get("custom_rates")?;
        let tool_custom_rates_val: serde_json::Value = row.try_get("tool_custom_rates").unwrap_or_else(|_| serde_json::json!({}));
        let monthly_tokens_consumed: i64 = row.try_get("monthly_tokens_consumed")?;
        let updated_at: chrono::DateTime<chrono::Utc> = row.try_get("updated_at")?;

        let volume_tiers = serde_json::from_value(volume_tiers_val).unwrap_or_default();
        let custom_rates = serde_json::from_value(custom_rates_val).unwrap_or_default();
        let tool_custom_rates = serde_json::from_value(tool_custom_rates_val).unwrap_or_default();

        Ok(crate::types::TenantPricingModel {
            org_id: org_id.to_string(),
            model_type,
            discount_bps: discount_bps as u32,
            volume_tiers,
            ptu_capacity_tokens: ptu_capacity_tokens as u64,
            token_cap_tokens: token_cap_tokens as u64,
            per_call_fee_micro_dollars: per_call_fee_micro_dollars as u64,
            custom_rates,
            tool_custom_rates,
            monthly_tokens_consumed: monthly_tokens_consumed as u64,
            updated_at: updated_at.to_rfc3339(),
        })
    }

    pub async fn record_token_consumption(
        &self,
        org_id: &str,
        tokens: u64,
    ) -> Result<u64, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO tenant_ai_pricing_models (org_id, monthly_tokens_consumed, updated_at)
            VALUES ($1, $2, NOW())
            ON CONFLICT (org_id) DO UPDATE SET
                monthly_tokens_consumed = tenant_ai_pricing_models.monthly_tokens_consumed + EXCLUDED.monthly_tokens_consumed,
                updated_at = NOW()
            RETURNING monthly_tokens_consumed
            "#,
        )
        .bind(org_id)
        .bind(tokens as i64)
        .fetch_one(&self.pool)
        .await?;

        let consumed: i64 = row.try_get("monthly_tokens_consumed")?;
        Ok(consumed as u64)
    }
}
