//! Approval-ticket signing.
//!
//! Signing is a read-modify-write on a JSON list of signers. Without a lock, two operators signing
//! at the same moment both read the same list and the later write silently drops the earlier
//! signature, so a transfer could stay stuck below its threshold or, worse, report progress that
//! did not happen. The ticket row is therefore locked (`FOR UPDATE`) for the whole operation.

use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{PgPool, Row};
use uuid::Uuid;

#[derive(Debug, PartialEq, Eq)]
pub enum SignOutcome {
    /// The signature was recorded. `reached` is true when this signature met the threshold.
    Recorded {
        collected: usize,
        required: i16,
        reached: bool,
    },
    /// This operator had already signed; nothing changed. Safe to retry.
    AlreadySigned { collected: usize, required: i16 },
    /// The ticket is no longer open (approved, rejected or expired) and the caller had not signed.
    NotOpen,
    /// No such ticket in the caller's organization.
    NotFound,
}

fn parse_signers(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|values| {
            values
                .iter()
                .filter_map(|value| value.as_str().map(str::to_string))
                .collect()
        })
        .unwrap_or_default()
}

/// Progress of a ticket if `subject` has already signed it, regardless of the ticket's status.
pub async fn signed_state(
    pool: &PgPool,
    org_id: &str,
    ticket_id: Uuid,
    subject: &str,
) -> Result<Option<(usize, i16)>, sqlx::Error> {
    let Some(row) = sqlx::query(
        "SELECT required_signatures, signatures FROM approval_tickets WHERE id = $1 AND org_id = $2",
    )
    .bind(ticket_id)
    .bind(org_id)
    .fetch_optional(pool)
    .await?
    else {
        return Ok(None);
    };
    let signers = parse_signers(&row.try_get::<Value, _>("signatures")?);
    if signers.iter().any(|existing| existing == subject) {
        Ok(Some((signers.len(), row.try_get("required_signatures")?)))
    } else {
        Ok(None)
    }
}

/// Records `subject`'s signature on the ticket atomically.
pub async fn record_signature(
    pool: &PgPool,
    org_id: &str,
    ticket_id: Uuid,
    subject: &str,
) -> Result<SignOutcome, sqlx::Error> {
    let mut tx = pool.begin().await?;
    let Some(row) = sqlx::query(
        "SELECT required_signatures, signatures, status FROM approval_tickets WHERE id = $1 AND org_id = $2 FOR UPDATE",
    )
    .bind(ticket_id)
    .bind(org_id)
    .fetch_optional(&mut *tx)
    .await?
    else {
        return Ok(SignOutcome::NotFound);
    };

    let required: i16 = row.try_get("required_signatures")?;
    let status: String = row.try_get("status")?;
    let mut signers = parse_signers(&row.try_get::<Value, _>("signatures")?);

    if signers.iter().any(|existing| existing == subject) {
        return Ok(SignOutcome::AlreadySigned {
            collected: signers.len(),
            required,
        });
    }
    if status != "open" {
        return Ok(SignOutcome::NotOpen);
    }

    signers.push(subject.to_string());
    let reached = signers.len() as i16 >= required;
    sqlx::query("UPDATE approval_tickets SET signatures = $2::jsonb, status = $3 WHERE id = $1")
        .bind(ticket_id)
        .bind(serde_json::to_value(&signers).unwrap_or(Value::Array(vec![])))
        .bind(if reached { "approved" } else { "open" })
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(SignOutcome::Recorded {
        collected: signers.len(),
        required,
        reached,
    })
}

/// One transfer waiting on signatures, with its ticket progress and the caller's wallet access.
#[derive(Debug)]
pub struct PendingRow {
    pub id: Uuid,
    pub direction: String,
    pub amount_base_units: String,
    pub agent_address: String,
    pub initiated_by_subject: String,
    pub created_at: DateTime<Utc>,
    pub expires_at: DateTime<Utc>,
    pub wallet_id: Uuid,
    pub wallet_label: String,
    pub wallet_address: String,
    pub required_signatures: i16,
    pub signers: Vec<String>,
    pub has_access: bool,
}

#[derive(Debug)]
pub struct PendingPage {
    /// All transfers awaiting approval in the organization.
    pub total: i64,
    /// How many of them this operator can sign right now (access granted, not signed yet).
    pub approvable: i64,
    pub has_more: bool,
    pub rows: Vec<PendingRow>,
}

/// Newest-first page of pending approvals. `cursor` is the `(created_at, id)` of the last row served.
pub async fn list_pending(
    pool: &PgPool,
    org_id: &str,
    subject: &str,
    is_super_admin: bool,
    limit: i64,
    cursor: Option<(DateTime<Utc>, Uuid)>,
) -> Result<PendingPage, sqlx::Error> {
    let totals = sqlx::query(
        r#"SELECT COUNT(*) AS total,
                  COUNT(*) FILTER (
                      WHERE ($3 OR owa.subject IS NOT NULL) AND NOT (tk.signatures ? $2)
                  ) AS approvable
           FROM wallet_transfers wt
           JOIN approval_tickets tk ON tk.id = wt.approval_ticket_id AND tk.org_id = wt.org_id
           LEFT JOIN organization_wallet_access owa
                  ON owa.wallet_id = wt.organization_wallet_id AND owa.subject = $2
           WHERE wt.org_id = $1 AND wt.status = 'pending_approval' AND tk.status = 'open'"#,
    )
    .bind(org_id)
    .bind(subject)
    .bind(is_super_admin)
    .fetch_one(pool)
    .await?;

    let mut rows = sqlx::query(
        r#"SELECT wt.id, wt.direction, wt.amount_base_units::text AS amount_base_units, wt.agent_address,
                  wt.initiated_by_subject, wt.created_at, ow.id AS wallet_id, ow.label AS wallet_label,
                  ow.address AS wallet_address, tk.required_signatures, tk.signatures, tk.expires_at,
                  (owa.subject IS NOT NULL) AS has_access
           FROM wallet_transfers wt
           JOIN organization_wallets ow ON ow.id = wt.organization_wallet_id
           JOIN approval_tickets tk ON tk.id = wt.approval_ticket_id AND tk.org_id = wt.org_id
           LEFT JOIN organization_wallet_access owa ON owa.wallet_id = ow.id AND owa.subject = $2
           WHERE wt.org_id = $1 AND wt.status = 'pending_approval' AND tk.status = 'open'
             AND ($3::timestamptz IS NULL OR (wt.created_at, wt.id) < ($3, $4))
           ORDER BY wt.created_at DESC, wt.id DESC
           LIMIT $5"#,
    )
    .bind(org_id)
    .bind(subject)
    .bind(cursor.map(|(created_at, _)| created_at))
    .bind(cursor.map(|(_, id)| id).unwrap_or_else(Uuid::nil))
    .bind(limit + 1)
    .fetch_all(pool)
    .await?;

    let has_more = rows.len() as i64 > limit;
    rows.truncate(limit as usize);
    let rows = rows
        .into_iter()
        .map(|row| {
            Ok(PendingRow {
                id: row.try_get("id")?,
                direction: row.try_get("direction")?,
                amount_base_units: row.try_get("amount_base_units")?,
                agent_address: row.try_get("agent_address")?,
                initiated_by_subject: row.try_get("initiated_by_subject")?,
                created_at: row.try_get("created_at")?,
                expires_at: row.try_get("expires_at")?,
                wallet_id: row.try_get("wallet_id")?,
                wallet_label: row.try_get("wallet_label")?,
                wallet_address: row.try_get("wallet_address")?,
                required_signatures: row.try_get("required_signatures")?,
                signers: parse_signers(&row.try_get::<Value, _>("signatures")?),
                has_access: row.try_get("has_access")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;

    Ok(PendingPage {
        total: totals.try_get("total")?,
        approvable: totals.try_get("approvable")?,
        has_more,
        rows,
    })
}
