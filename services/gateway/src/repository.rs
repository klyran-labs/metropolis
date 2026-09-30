use crate::{
    abac::AbacPolicy,
    auth::{ApiKeyIdentity, OperatorIdentity},
    pbac::PbacPolicy,
};
use alloy::primitives::{Address, U256};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{Row, postgres::PgPool};
use uuid::Uuid;

fn pricing_decode_error(message: impl Into<String>) -> sqlx::Error {
    sqlx::Error::Decode(Box::new(std::io::Error::new(
        std::io::ErrorKind::InvalidData,
        message.into(),
    )))
}

fn nonnegative_u64(value: i64, field: &str) -> Result<u64, sqlx::Error> {
    u64::try_from(value).map_err(|_| pricing_decode_error(format!("{field} must be non-negative")))
}

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
                nonnegative_u64(row.try_get::<i64, _>("next_block")?, "next_block")?,
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
    pub async fn apply_finops_sync(
        &self,
        org_id: &str,
        node_id: &str,
        sequence_number: u64,
        delta_tokens: u64,
    ) -> Result<(bool, crate::types::TenantPricingModel), sqlx::Error> {
        let sequence_number = i64::try_from(sequence_number).map_err(|_| {
            sqlx::Error::Decode(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FinOps sequence number exceeds PostgreSQL bigint",
            )))
        })?;
        let delta_tokens = i64::try_from(delta_tokens).map_err(|_| {
            sqlx::Error::Decode(Box::new(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "FinOps token delta exceeds PostgreSQL bigint",
            )))
        })?;

        let mut tx = self.pool.begin().await?;
        let inserted = sqlx::query(
            "INSERT INTO finops_sync_ledger (org_id, node_id, sequence_number, delta_tokens) VALUES ($1, $2, $3, $4) ON CONFLICT (org_id, node_id, sequence_number) DO NOTHING",
        )
        .bind(org_id)
        .bind(node_id)
        .bind(sequence_number)
        .bind(delta_tokens)
        .execute(&mut *tx)
        .await?
        .rows_affected()
            == 1;

        if inserted {
            let updated = sqlx::query(
                "UPDATE tenant_ai_pricing_models SET monthly_tokens_consumed = monthly_tokens_consumed + $2, updated_at = NOW() WHERE org_id = $1",
            )
            .bind(org_id)
            .bind(delta_tokens)
            .execute(&mut *tx)
            .await?;
            if updated.rows_affected() != 1 {
                return Err(sqlx::Error::RowNotFound);
            }
        }
        tx.commit().await?;

        let model = self.load_tenant_pricing_model(org_id).await?;
        Ok((inserted, model))
    }

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
                _ => {
                    return Err(pricing_decode_error(
                        "tenant pricing model contains an unknown model_type",
                    ));
                }
            };
            let discount_bps: i32 = row.try_get("discount_bps")?;
            let volume_tiers_val: serde_json::Value = row.try_get("volume_tiers")?;
            let ptu_capacity_tokens: i64 = row.try_get("ptu_capacity_tokens")?;
            let token_cap_tokens: i64 = row.try_get("token_cap_tokens")?;
            let per_call_fee_micro_dollars: i64 = row.try_get("per_call_fee_micro_dollars")?;
            let custom_rates_val: serde_json::Value = row.try_get("custom_rates")?;
            let tool_custom_rates_val: serde_json::Value = row.try_get("tool_custom_rates")?;
            let monthly_tokens_consumed: i64 = row.try_get("monthly_tokens_consumed")?;
            let updated_at: chrono::DateTime<chrono::Utc> = row.try_get("updated_at")?;

            let volume_tiers = serde_json::from_value(volume_tiers_val)
                .map_err(|error| pricing_decode_error(format!("Invalid volume tiers: {error}")))?;
            let custom_rates = serde_json::from_value(custom_rates_val)
                .map_err(|error| pricing_decode_error(format!("Invalid custom rates: {error}")))?;
            let tool_custom_rates = serde_json::from_value(tool_custom_rates_val)
                .map_err(|error| pricing_decode_error(format!("Invalid tool rates: {error}")))?;

            Ok(crate::types::TenantPricingModel {
                org_id: org_id.to_string(),
                model_type,
                discount_bps: u32::try_from(discount_bps)
                    .map_err(|_| pricing_decode_error("discount_bps is outside the u32 range"))?,
                volume_tiers,
                ptu_capacity_tokens: nonnegative_u64(ptu_capacity_tokens, "ptu_capacity_tokens")?,
                token_cap_tokens: nonnegative_u64(token_cap_tokens, "token_cap_tokens")?,
                per_call_fee_micro_dollars: nonnegative_u64(
                    per_call_fee_micro_dollars,
                    "per_call_fee_micro_dollars",
                )?,
                custom_rates,
                tool_custom_rates,
                monthly_tokens_consumed: nonnegative_u64(
                    monthly_tokens_consumed,
                    "monthly_tokens_consumed",
                )?,
                updated_at: updated_at.to_rfc3339(),
            })
        } else {
            Err(sqlx::Error::RowNotFound)
        }
    }

    pub async fn upsert_tenant_pricing_model(
        &self,
        org_id: &str,
        req: &crate::types::UpdatePricingModelRequest,
    ) -> Result<crate::types::TenantPricingModel, sqlx::Error> {
        let discount_bps = i32::try_from(req.discount_bps)
            .map_err(|_| pricing_decode_error("discount_bps exceeds PostgreSQL integer range"))?;
        let ptu_capacity_tokens = i64::try_from(req.ptu_capacity_tokens).map_err(|_| {
            pricing_decode_error("ptu_capacity_tokens exceeds PostgreSQL bigint range")
        })?;
        let token_cap_tokens = i64::try_from(req.token_cap_tokens).map_err(|_| {
            pricing_decode_error("token_cap_tokens exceeds PostgreSQL bigint range")
        })?;
        let per_call_fee_micro_dollars =
            i64::try_from(req.per_call_fee_micro_dollars).map_err(|_| {
                pricing_decode_error("per_call_fee_micro_dollars exceeds PostgreSQL bigint range")
            })?;
        let model_type_str = match req.model_type {
            crate::types::PricingModelType::FlatDiscount => "flat_discount",
            crate::types::PricingModelType::TieredVolume => "tiered_volume",
            crate::types::PricingModelType::CommittedPtu => "committed_ptu",
            crate::types::PricingModelType::BatchDiscount => "batch_discount",
            crate::types::PricingModelType::PerUnitRequest => "per_unit_request",
            crate::types::PricingModelType::HybridCommitVolume => "hybrid_commit_volume",
        };
        let volume_tiers_val = serde_json::to_value(&req.volume_tiers)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        let custom_rates_val = serde_json::to_value(&req.custom_rates)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;
        let tool_custom_rates_val = serde_json::to_value(&req.tool_custom_rates)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?;

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
        .bind(discount_bps)
        .bind(volume_tiers_val)
        .bind(ptu_capacity_tokens)
        .bind(token_cap_tokens)
        .bind(per_call_fee_micro_dollars)
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
            _ => {
                return Err(pricing_decode_error(
                    "tenant pricing model contains an unknown model_type",
                ));
            }
        };
        let discount_bps: i32 = row.try_get("discount_bps")?;
        let volume_tiers_val: serde_json::Value = row.try_get("volume_tiers")?;
        let ptu_capacity_tokens: i64 = row.try_get("ptu_capacity_tokens")?;
        let token_cap_tokens: i64 = row.try_get("token_cap_tokens")?;
        let per_call_fee_micro_dollars: i64 = row.try_get("per_call_fee_micro_dollars")?;
        let custom_rates_val: serde_json::Value = row.try_get("custom_rates")?;
        let tool_custom_rates_val: serde_json::Value = row.try_get("tool_custom_rates")?;
        let monthly_tokens_consumed: i64 = row.try_get("monthly_tokens_consumed")?;
        let updated_at: chrono::DateTime<chrono::Utc> = row.try_get("updated_at")?;

        let volume_tiers = serde_json::from_value(volume_tiers_val)
            .map_err(|error| pricing_decode_error(format!("Invalid volume tiers: {error}")))?;
        let custom_rates = serde_json::from_value(custom_rates_val)
            .map_err(|error| pricing_decode_error(format!("Invalid custom rates: {error}")))?;
        let tool_custom_rates = serde_json::from_value(tool_custom_rates_val)
            .map_err(|error| pricing_decode_error(format!("Invalid tool rates: {error}")))?;

        Ok(crate::types::TenantPricingModel {
            org_id: org_id.to_string(),
            model_type,
            discount_bps: u32::try_from(discount_bps)
                .map_err(|_| pricing_decode_error("discount_bps is outside the u32 range"))?,
            volume_tiers,
            ptu_capacity_tokens: nonnegative_u64(ptu_capacity_tokens, "ptu_capacity_tokens")?,
            token_cap_tokens: nonnegative_u64(token_cap_tokens, "token_cap_tokens")?,
            per_call_fee_micro_dollars: nonnegative_u64(
                per_call_fee_micro_dollars,
                "per_call_fee_micro_dollars",
            )?,
            custom_rates,
            tool_custom_rates,
            monthly_tokens_consumed: nonnegative_u64(
                monthly_tokens_consumed,
                "monthly_tokens_consumed",
            )?,
            updated_at: updated_at.to_rfc3339(),
        })
    }

    pub async fn record_token_consumption(
        &self,
        org_id: &str,
        tokens: u64,
    ) -> Result<u64, sqlx::Error> {
        let tokens = i64::try_from(tokens).map_err(|_| {
            pricing_decode_error("token consumption exceeds PostgreSQL bigint range")
        })?;
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
        .bind(tokens)
        .fetch_one(&self.pool)
        .await?;

        let consumed: i64 = row.try_get("monthly_tokens_consumed")?;
        nonnegative_u64(consumed, "monthly_tokens_consumed")
    }

    /// Atomically inserts a verified payment voucher into the durable PostgreSQL transactional outbox.
    pub async fn insert_settlement_outbox(
        &self,
        record: &NewSettlementOutboxRecord<'_>,
    ) -> Result<SettlementOutboxRecord, sqlx::Error> {
        let row = sqlx::query(
            r#"
            INSERT INTO settlement_outbox (
                task_id, agent_address, merchant_address, token_address,
                amount, nonce, signature, category, timestamp_val, deadline,
                status, trace_id, created_at, updated_at
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', $11, NOW(), NOW())
            RETURNING
                id, task_id, agent_address, merchant_address, token_address,
                amount, nonce, signature, category, timestamp_val, deadline,
                status, tx_hash, attempt_count, max_attempts, next_retry_at,
                last_error, trace_id, created_at, updated_at
            "#,
        )
        .bind(record.task_id)
        .bind(format!("{:#x}", record.agent))
        .bind(format!("{:#x}", record.merchant))
        .bind(format!("{:#x}", record.token))
        .bind(record.amount.to_string())
        .bind(record.nonce.to_string())
        .bind(record.signature)
        .bind(record.category)
        .bind(record.timestamp.to_string())
        .bind(record.deadline.to_string())
        .bind(record.trace_id)
        .fetch_one(&self.pool)
        .await?;

        map_outbox_row(&row)
    }

    /// Pessimistically claims a batch of pending settlement vouchers for clearing using SELECT ... FOR UPDATE SKIP LOCKED.
    pub async fn claim_pending_settlement_batch(
        &self,
        limit: i64,
    ) -> Result<Vec<SettlementOutboxRecord>, sqlx::Error> {
        let rows = sqlx::query(
            r#"
            UPDATE settlement_outbox
            SET status = 'dispatched',
                attempt_count = attempt_count + 1,
                updated_at = NOW()
            WHERE id IN (
                SELECT id FROM settlement_outbox
                WHERE status IN ('pending', 'failed')
                  AND next_retry_at <= NOW()
                  AND attempt_count < max_attempts
                ORDER BY created_at ASC
                LIMIT $1
                FOR UPDATE SKIP LOCKED
            )
            RETURNING
                id, task_id, agent_address, merchant_address, token_address,
                amount, nonce, signature, category, timestamp_val, deadline,
                status, tx_hash, attempt_count, max_attempts, next_retry_at,
                last_error, trace_id, created_at, updated_at
            "#,
        )
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;

        rows.iter().map(map_outbox_row).collect()
    }

    /// Marks a settlement voucher as confirmed and mined on Monad Parallel EVM.
    pub async fn mark_settlement_mined(
        &self,
        id: Uuid,
        tx_hash: &str,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE settlement_outbox
            SET status = 'mined',
                tx_hash = $2,
                last_error = NULL,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(tx_hash)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Marks a settlement attempt as failed and schedules a retry with exponential backoff.
    pub async fn mark_settlement_failed(
        &self,
        id: Uuid,
        error_msg: &str,
        next_retry_at: DateTime<Utc>,
    ) -> Result<(), sqlx::Error> {
        sqlx::query(
            r#"
            UPDATE settlement_outbox
            SET status = CASE WHEN attempt_count >= max_attempts THEN 'dead_letter' ELSE 'failed' END,
                last_error = $2,
                next_retry_at = $3,
                updated_at = NOW()
            WHERE id = $1
            "#,
        )
        .bind(id)
        .bind(error_msg)
        .bind(next_retry_at)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Lists settlement outbox records with optional status filtering.
    pub async fn list_settlement_outbox(
        &self,
        limit: i64,
        status_filter: Option<&str>,
    ) -> Result<Vec<SettlementOutboxRecord>, sqlx::Error> {
        let rows = match status_filter {
            Some(status) => {
                sqlx::query(
                    r#"
                    SELECT id, task_id, agent_address, merchant_address, token_address,
                           amount, nonce, signature, category, timestamp_val, deadline,
                           status, tx_hash, attempt_count, max_attempts, next_retry_at,
                           last_error, trace_id, created_at, updated_at
                    FROM settlement_outbox
                    WHERE status = $1
                    ORDER BY created_at DESC
                    LIMIT $2
                    "#,
                )
                .bind(status)
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
            None => {
                sqlx::query(
                    r#"
                    SELECT id, task_id, agent_address, merchant_address, token_address,
                           amount, nonce, signature, category, timestamp_val, deadline,
                           status, tx_hash, attempt_count, max_attempts, next_retry_at,
                           last_error, trace_id, created_at, updated_at
                    FROM settlement_outbox
                    ORDER BY created_at DESC
                    LIMIT $1
                    "#,
                )
                .bind(limit)
                .fetch_all(&self.pool)
                .await?
            }
        };

        rows.iter().map(map_outbox_row).collect()
    }

    /// Re-queues a dead-letter settlement voucher for immediate retry.
    pub async fn retry_dead_letter_settlement(&self, id: Uuid) -> Result<bool, sqlx::Error> {
        let result = sqlx::query(
            r#"
            UPDATE settlement_outbox
            SET status = 'pending',
                attempt_count = 0,
                next_retry_at = NOW(),
                updated_at = NOW()
            WHERE id = $1 AND status = 'dead_letter'
            "#,
        )
        .bind(id)
        .execute(&self.pool)
        .await?;

        Ok(result.rows_affected() > 0)
    }

    /// Computes aggregated settlement queue statistics.
    pub async fn get_settlement_queue_stats(&self) -> Result<SettlementQueueStats, sqlx::Error> {
        let row = sqlx::query(
            r#"
            SELECT
                COALESCE(COUNT(*) FILTER (WHERE status = 'pending'), 0) as pending_count,
                COALESCE(COUNT(*) FILTER (WHERE status = 'dispatched'), 0) as dispatched_count,
                COALESCE(COUNT(*) FILTER (WHERE status = 'mined'), 0) as mined_count,
                COALESCE(COUNT(*) FILTER (WHERE status = 'failed'), 0) as failed_count,
                COALESCE(COUNT(*) FILTER (WHERE status = 'dead_letter'), 0) as dead_letter_count,
                COUNT(*) as total_count
            FROM settlement_outbox
            "#,
        )
        .fetch_one(&self.pool)
        .await?;

        Ok(SettlementQueueStats {
            pending: row.try_get("pending_count")?,
            dispatched: row.try_get("dispatched_count")?,
            mined: row.try_get("mined_count")?,
            failed: row.try_get("failed_count")?,
            dead_letter: row.try_get("dead_letter_count")?,
            total: row.try_get("total_count")?,
        })
    }
}

#[derive(Clone, Debug)]
pub struct NewSettlementOutboxRecord<'a> {
    pub task_id: Uuid,
    pub agent: Address,
    pub merchant: Address,
    pub token: Address,
    pub amount: U256,
    pub nonce: U256,
    pub signature: &'a [u8],
    pub category: &'a [u8],
    pub timestamp: U256,
    pub deadline: U256,
    pub trace_id: Option<&'a str>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SettlementOutboxRecord {
    pub id: Uuid,
    pub task_id: Uuid,
    pub agent_address: String,
    pub merchant_address: String,
    pub token_address: String,
    pub amount: String,
    pub nonce: String,
    pub signature: Vec<u8>,
    pub category: Vec<u8>,
    pub timestamp_val: String,
    pub deadline: String,
    pub status: String,
    pub tx_hash: Option<String>,
    pub attempt_count: i32,
    pub max_attempts: i32,
    pub next_retry_at: DateTime<Utc>,
    pub last_error: Option<String>,
    pub trace_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct SettlementQueueStats {
    pub pending: i64,
    pub dispatched: i64,
    pub mined: i64,
    pub failed: i64,
    pub dead_letter: i64,
    pub total: i64,
}

fn map_outbox_row(row: &sqlx::postgres::PgRow) -> Result<SettlementOutboxRecord, sqlx::Error> {
    Ok(SettlementOutboxRecord {
        id: row.try_get("id")?,
        task_id: row.try_get("task_id")?,
        agent_address: row.try_get("agent_address")?,
        merchant_address: row.try_get("merchant_address")?,
        token_address: row.try_get("token_address")?,
        amount: row.try_get("amount")?,
        nonce: row.try_get("nonce")?,
        signature: row.try_get("signature")?,
        category: row.try_get("category")?,
        timestamp_val: row.try_get("timestamp_val")?,
        deadline: row.try_get("deadline")?,
        status: row.try_get("status")?,
        tx_hash: row.try_get("tx_hash")?,
        attempt_count: row.try_get("attempt_count")?,
        max_attempts: row.try_get("max_attempts")?,
        next_retry_at: row.try_get("next_retry_at")?,
        last_error: row.try_get("last_error")?,
        trace_id: row.try_get("trace_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}
