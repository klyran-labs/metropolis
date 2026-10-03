//! Postgres-backed tests for approval signing. They run only when `GATEWAY_TEST_DATABASE_URL`
//! points at a maintenance database (for example `postgres://user:pass@127.0.0.1:5432/postgres`);
//! each test creates and drops its own database, so no existing data is touched.

use agentguard_gateway::approvals::{SignOutcome, list_pending, record_signature, signed_state};
use chrono::{DateTime, Utc};
use futures_util::future::join_all;
use sqlx::{PgPool, postgres::PgPoolOptions};
use uuid::Uuid;

struct TestDb {
    admin: PgPool,
    pool: PgPool,
    name: String,
}

impl TestDb {
    async fn create() -> Option<Self> {
        // Unset means "not configured" and the test is skipped. Set but unusable is a real failure.
        let url = std::env::var("GATEWAY_TEST_DATABASE_URL").ok()?;
        let admin = PgPoolOptions::new()
            .max_connections(2)
            .connect(&url)
            .await
            .expect("GATEWAY_TEST_DATABASE_URL is set but the database is not reachable");
        let name = format!("approvals_test_{}", Uuid::now_v7().simple());
        sqlx::query(&format!("CREATE DATABASE {name}"))
            .execute(&admin)
            .await
            .expect("create test database");
        let index = url
            .rfind('/')
            .expect("GATEWAY_TEST_DATABASE_URL must end with /<database>");
        let db_url = format!("{}/{}", &url[..index], name);
        let pool = PgPoolOptions::new()
            .max_connections(16)
            .connect(&db_url)
            .await
            .expect("connect test database");
        sqlx::migrate!("./migrations")
            .run(&pool)
            .await
            .expect("apply migrations");
        Some(Self { admin, pool, name })
    }

    async fn drop_db(self) {
        self.pool.close().await;
        let _ = sqlx::query(&format!(
            "DROP DATABASE IF EXISTS {} WITH (FORCE)",
            self.name
        ))
        .execute(&self.admin)
        .await;
    }

    async fn ticket(&self, org: &str, required: i16) -> Uuid {
        sqlx::query("INSERT INTO organizations(org_id, enterprise_address) VALUES ($1, '0xabc') ON CONFLICT DO NOTHING")
            .bind(org)
            .execute(&self.pool)
            .await
            .expect("organization");
        let row: (Uuid,) = sqlx::query_as(
            "INSERT INTO approval_tickets(org_id, resource, required_signatures, expires_at) VALUES ($1, 'transfer', $2, NOW() + interval '1 day') RETURNING id",
        )
        .bind(org)
        .bind(required)
        .fetch_one(&self.pool)
        .await
        .expect("ticket");
        row.0
    }
}

#[tokio::test]
async fn concurrent_signers_never_lose_a_signature() {
    let Some(db) = TestDb::create().await else {
        eprintln!("skipped: GATEWAY_TEST_DATABASE_URL is not set");
        return;
    };
    let org = Uuid::now_v7().to_string();
    let ticket = db.ticket(&org, 5).await;

    let outcomes = join_all((0..5).map(|index| {
        let pool = db.pool.clone();
        let org = org.clone();
        async move {
            record_signature(&pool, &org, ticket, &format!("did:privy:op{index}"))
                .await
                .expect("sign")
        }
    }))
    .await;

    let mut collected: Vec<usize> = outcomes
        .iter()
        .map(|outcome| match outcome {
            SignOutcome::Recorded { collected, .. } => *collected,
            other => panic!("unexpected outcome {other:?}"),
        })
        .collect();
    collected.sort_unstable();
    assert_eq!(
        collected,
        vec![1, 2, 3, 4, 5],
        "every signer must see a distinct running count"
    );
    let reached = outcomes
        .iter()
        .filter(|outcome| matches!(outcome, SignOutcome::Recorded { reached: true, .. }))
        .count();
    assert_eq!(reached, 1, "exactly one signer completes the approval");

    let row: (serde_json::Value, String) =
        sqlx::query_as("SELECT signatures, status FROM approval_tickets WHERE id = $1")
            .bind(ticket)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    assert_eq!(row.0.as_array().map(Vec::len), Some(5));
    assert_eq!(row.1, "approved");
    db.drop_db().await;
}

#[tokio::test]
async fn repeat_signing_is_idempotent_and_closed_tickets_reject_new_signers() {
    let Some(db) = TestDb::create().await else {
        eprintln!("skipped: GATEWAY_TEST_DATABASE_URL is not set");
        return;
    };
    let org = Uuid::now_v7().to_string();
    let ticket = db.ticket(&org, 2).await;

    assert_eq!(
        record_signature(&db.pool, &org, ticket, "alice")
            .await
            .unwrap(),
        SignOutcome::Recorded {
            collected: 1,
            required: 2,
            reached: false
        }
    );
    // Same operator again: no change, no error.
    assert_eq!(
        record_signature(&db.pool, &org, ticket, "alice")
            .await
            .unwrap(),
        SignOutcome::AlreadySigned {
            collected: 1,
            required: 2
        }
    );
    assert_eq!(
        record_signature(&db.pool, &org, ticket, "bob")
            .await
            .unwrap(),
        SignOutcome::Recorded {
            collected: 2,
            required: 2,
            reached: true
        }
    );
    // Ticket is now approved: a late retry by a prior signer is still harmless, a new signer is refused.
    assert_eq!(
        record_signature(&db.pool, &org, ticket, "alice")
            .await
            .unwrap(),
        SignOutcome::AlreadySigned {
            collected: 2,
            required: 2
        }
    );
    assert_eq!(
        record_signature(&db.pool, &org, ticket, "carol")
            .await
            .unwrap(),
        SignOutcome::NotOpen
    );
    assert_eq!(
        signed_state(&db.pool, &org, ticket, "bob").await.unwrap(),
        Some((2, 2))
    );
    assert_eq!(
        signed_state(&db.pool, &org, ticket, "carol").await.unwrap(),
        None
    );

    // Another organization cannot see or sign the ticket.
    assert_eq!(
        record_signature(&db.pool, &Uuid::now_v7().to_string(), ticket, "mallory")
            .await
            .unwrap(),
        SignOutcome::NotFound
    );
    db.drop_db().await;
}

impl TestDb {
    /// Inserts a wallet and `count` pending transfers (each with its own ticket); returns the wallet id.
    async fn pending_transfers(&self, org: &str, count: usize, required: i16) -> Uuid {
        sqlx::query("INSERT INTO organizations(org_id, enterprise_address) VALUES ($1, '0xabc') ON CONFLICT DO NOTHING")
            .bind(org)
            .execute(&self.pool)
            .await
            .expect("organization");
        let wallet: (Uuid,) = sqlx::query_as(
            "INSERT INTO organization_wallets(org_id, address, label, kind, created_by_subject) VALUES ($1, $2, 'Main', 'sovereign', 'admin') RETURNING id",
        )
        .bind(org)
        .bind(format!("0x{}", Uuid::now_v7().simple()))
        .fetch_one(&self.pool)
        .await
        .expect("wallet");
        for index in 0..count {
            let ticket = self.ticket(org, required).await;
            sqlx::query(
                "INSERT INTO wallet_transfers(org_id, direction, organization_wallet_id, agent_address, token_address, amount_base_units, status, initiated_by_subject, approval_ticket_id, created_at) VALUES ($1, 'load', $2, '0xagent', '0xtoken', 1000000, 'pending_approval', 'admin', $3, NOW() - ($4 || ' seconds')::interval)",
            )
            .bind(org)
            .bind(wallet.0)
            .bind(ticket)
            .bind(index.to_string())
            .execute(&self.pool)
            .await
            .expect("transfer");
        }
        wallet.0
    }
}

#[tokio::test]
async fn pending_list_pages_without_gaps_and_counts_what_the_operator_can_sign() {
    let Some(db) = TestDb::create().await else {
        eprintln!("skipped: GATEWAY_TEST_DATABASE_URL is not set");
        return;
    };
    let org = Uuid::now_v7().to_string();
    let wallet = db.pending_transfers(&org, 7, 2).await;
    sqlx::query("INSERT INTO organization_wallet_access(wallet_id, subject, granted_by_subject) VALUES ($1, 'bob', 'admin')")
        .bind(wallet)
        .execute(&db.pool)
        .await
        .unwrap();

    // Walk the list three at a time: 3 + 3 + 1, newest first, every transfer exactly once.
    let mut seen: Vec<Uuid> = Vec::new();
    let mut cursor: Option<(DateTime<Utc>, Uuid)> = None;
    let mut pages = 0;
    loop {
        let page = list_pending(&db.pool, &org, "bob", false, 3, cursor)
            .await
            .unwrap();
        assert_eq!(page.total, 7, "total is independent of the page");
        assert_eq!(
            page.approvable, 7,
            "bob has wallet access and has signed nothing"
        );
        seen.extend(page.rows.iter().map(|row| row.id));
        pages += 1;
        match (page.has_more, page.rows.last()) {
            (true, Some(last)) => cursor = Some((last.created_at, last.id)),
            _ => break,
        }
    }
    assert_eq!(pages, 3);
    assert_eq!(seen.len(), 7);
    let mut unique = seen.clone();
    unique.sort();
    unique.dedup();
    assert_eq!(unique.len(), 7, "no transfer repeats across pages");

    // Someone without wallet access sees the same list but can sign none of it.
    let carol = list_pending(&db.pool, &org, "carol", false, 50, None)
        .await
        .unwrap();
    assert_eq!((carol.total, carol.approvable), (7, 0));
    assert!(carol.rows.iter().all(|row| !row.has_access));
    // A super admin can sign all of them without a grant.
    let root = list_pending(&db.pool, &org, "root", true, 50, None)
        .await
        .unwrap();
    assert_eq!(root.approvable, 7);

    // Signing removes that transfer from bob's approvable count but not from the total.
    let first_ticket: (Uuid,) =
        sqlx::query_as("SELECT approval_ticket_id FROM wallet_transfers WHERE org_id = $1 LIMIT 1")
            .bind(&org)
            .fetch_one(&db.pool)
            .await
            .unwrap();
    record_signature(&db.pool, &org, first_ticket.0, "bob")
        .await
        .unwrap();
    let after = list_pending(&db.pool, &org, "bob", false, 50, None)
        .await
        .unwrap();
    assert_eq!((after.total, after.approvable), (7, 6));

    // Other organizations see nothing.
    let other = list_pending(
        &db.pool,
        &Uuid::now_v7().to_string(),
        "bob",
        false,
        50,
        None,
    )
    .await
    .unwrap();
    assert_eq!((other.total, other.rows.len()), (0, 0));
    db.drop_db().await;
}
