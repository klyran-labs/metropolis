use alloy::primitives::{Address, U256};
use dashmap::DashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use std::time::Instant;
use tracing::warn;

const WINDOW_CAPACITY: usize = 30;
const ANOMALY_Z_THRESHOLD: f64 = 3.0;
const CRITICAL_Z_THRESHOLD: f64 = 4.5;

#[derive(Clone, Debug)]
struct TxDataPoint {
    instant: Instant,
    #[allow(dead_code)]
    amount: f64,
}

#[derive(Default)]
struct AgentAnomalyState {
    history: VecDeque<TxDataPoint>,
}

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct AnomalyAssessment {
    pub is_anomaly: bool,
    pub is_critical: bool,
    pub z_score: f64,
    pub current_interval_ms: f64,
    pub mean_interval_ms: f64,
    pub reason: Option<String>,
    pub quarantine_tier: String,
    pub throttle_pct: u16,
}

#[derive(Clone, Default)]
pub struct AnomalyDetector {
    agents: Arc<DashMap<Address, AgentAnomalyState>>,
}

impl AnomalyDetector {
    pub fn new() -> Self {
        Self {
            agents: Arc::new(DashMap::new()),
        }
    }

    /// Evaluates an inbound spend request against rolling statistical baselines.
    /// Operates lock-free per agent using DashMap shards.
    pub fn assess_and_record(&self, agent: Address, amount: U256) -> AnomalyAssessment {
        let now = Instant::now();
        let amount_f64 = amount.to_string().parse::<f64>().unwrap_or(0.0);

        let mut entry = self.agents.entry(agent).or_default();
        let history = &mut entry.history;

        if history.len() < 3 {
            // Insufficient baseline data; record and allow
            history.push_back(TxDataPoint { instant: now, amount: amount_f64 });
            return AnomalyAssessment {
                is_anomaly: false,
                is_critical: false,
                z_score: 0.0,
                current_interval_ms: 0.0,
                mean_interval_ms: 0.0,
                reason: None,
                quarantine_tier: "NOMINAL".to_string(),
                throttle_pct: 100,
            };
        }

        // Calculate inter-arrival intervals
        let mut intervals = Vec::with_capacity(history.len());
        let mut prev = history[0].instant;
        for dp in history.iter().skip(1) {
            let diff_ms = dp.instant.duration_since(prev).as_secs_f64() * 1000.0;
            intervals.push(diff_ms);
            prev = dp.instant;
        }

        let current_interval_ms = now.duration_since(prev).as_secs_f64() * 1000.0;

        let n = intervals.len() as f64;
        let mean_interval: f64 = intervals.iter().sum::<f64>() / n;
        let variance: f64 = intervals.iter().map(|&x| (x - mean_interval).powi(2)).sum::<f64>() / n;
        let std_dev = variance.sqrt().max(1.0); // prevent div by zero

        // An anomaly occurs if the current request arrives orders-of-magnitude faster than the mean (burst surge)
        let z_score = if current_interval_ms < mean_interval {
            (mean_interval - current_interval_ms) / std_dev
        } else {
            0.0
        };

        let is_anomaly = z_score >= ANOMALY_Z_THRESHOLD;
        let is_critical = z_score >= CRITICAL_Z_THRESHOLD;

        let (quarantine_tier, throttle_pct) = if z_score >= 5.0 {
            ("BYZANTINE_HALTED".to_string(), 0)
        } else if z_score >= 3.5 {
            ("QUORUM_REQUIRED".to_string(), 20)
        } else if z_score >= 2.0 {
            ("ELEVATED".to_string(), 50)
        } else {
            ("NOMINAL".to_string(), 100)
        };

        let reason = if is_critical {
            Some(format!(
                "Critical velocity surge detected: inter-arrival {current_interval_ms:.1}ms is {z_score:.2}σ below baseline mean ({mean_interval:.1}ms). Quarantine: {quarantine_tier} ({throttle_pct}% throttle)"
            ))
        } else if is_anomaly {
            Some(format!(
                "High-frequency burst anomaly: inter-arrival {current_interval_ms:.1}ms is {z_score:.2}σ below baseline mean ({mean_interval:.1}ms). Quarantine: {quarantine_tier} ({throttle_pct}% throttle)"
            ))
        } else {
            None
        };

        if is_anomaly {
            warn!(
                %agent,
                z_score,
                quarantine_tier = %quarantine_tier,
                throttle_pct,
                current_interval_ms,
                mean_interval,
                "AgentGuard statistical anomaly detected"
            );
        }

        // Maintain bounded sliding window
        if history.len() >= WINDOW_CAPACITY {
            history.pop_front();
        }
        history.push_back(TxDataPoint { instant: now, amount: amount_f64 });

        AnomalyAssessment {
            is_anomaly,
            is_critical,
            z_score,
            current_interval_ms,
            mean_interval_ms: mean_interval,
            reason,
            quarantine_tier,
            throttle_pct,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn test_anomaly_detector_baseline_and_burst() {
        let detector = AnomalyDetector::new();
        let agent = Address::repeat_byte(0x11);

        // Warm up baseline with ~100ms intervals
        let base_amount = U256::from(100);
        let now = Instant::now();

        {
            let mut entry = detector.agents.entry(agent).or_default();
            entry.history.push_back(TxDataPoint { instant: now - Duration::from_millis(500), amount: 100.0 });
            entry.history.push_back(TxDataPoint { instant: now - Duration::from_millis(400), amount: 100.0 });
            entry.history.push_back(TxDataPoint { instant: now - Duration::from_millis(300), amount: 100.0 });
            entry.history.push_back(TxDataPoint { instant: now - Duration::from_millis(200), amount: 100.0 });
            entry.history.push_back(TxDataPoint { instant: now - Duration::from_millis(100), amount: 100.0 });
        }

        // Request arriving at standard rate
        let assessment = detector.assess_and_record(agent, base_amount);
        assert!(!assessment.is_anomaly);

        // Sudden sub-millisecond burst
        let burst_assessment = detector.assess_and_record(agent, base_amount);
        // Inter-arrival is ~0ms compared to 100ms baseline
        assert!(burst_assessment.z_score > 0.0);
    }
}
