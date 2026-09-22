use agentguard_gateway::{
    finops::calculate_inference_spend, limits::TenantConcurrency, types::TenantPricingModel,
};
use std::{hint::black_box, sync::Arc, thread, time::Instant};

const ITERATIONS: usize = 50_000;

fn percentile(samples: &mut [u128], quantile: f64) -> u128 {
    samples.sort_unstable();
    let index = ((samples.len() as f64 - 1.0) * quantile).round() as usize;
    samples[index]
}

fn report(name: &str, samples: &mut [u128]) {
    let p50 = percentile(samples, 0.50);
    let p95 = percentile(samples, 0.95);
    let p99 = percentile(samples, 0.99);
    let p999 = percentile(samples, 0.999);
    println!(
        "{name}: samples={} p50={}ns p95={}ns p99={}ns p99.9={}ns",
        samples.len(),
        p50,
        p95,
        p99,
        p999
    );
}

fn main() {
    let pricing = TenantPricingModel::default();
    let mut spend_samples = Vec::with_capacity(ITERATIONS);
    for index in 0..ITERATIONS {
        let started = Instant::now();
        black_box(
            calculate_inference_spend(
                "qwen-max",
                1_024 + (index as u64 % 128),
                512 + (index as u64 % 64),
                0,
                0,
                &pricing,
            )
            .expect("catalog model must have an authoritative rate"),
        );
        spend_samples.push(started.elapsed().as_nanos());
    }
    report("fixed_point_spend", &mut spend_samples);

    let limits = Arc::new(TenantConcurrency::new(64, 32).expect("valid benchmark limits"));
    let tenants: Arc<[&'static str]> = Arc::new([
        "org-00", "org-01", "org-02", "org-03", "org-04", "org-05", "org-06", "org-07", "org-08",
        "org-09", "org-10", "org-11", "org-12", "org-13", "org-14", "org-15",
    ]);
    let barrier = Arc::new(std::sync::Barrier::new(8));
    let workers = (0..8)
        .map(|worker| {
            let limits = Arc::clone(&limits);
            let tenants = Arc::clone(&tenants);
            let barrier = Arc::clone(&barrier);
            thread::spawn(move || {
                let mut samples = Vec::with_capacity(ITERATIONS / 8);
                barrier.wait();
                for index in 0..(ITERATIONS / 8) {
                    let started = Instant::now();
                    let permit = limits.try_acquire(tenants[(index + worker) % tenants.len()]);
                    black_box(permit.is_some());
                    drop(permit);
                    samples.push(started.elapsed().as_nanos());
                }
                samples
            })
        })
        .collect::<Vec<_>>();

    let mut admission_samples = workers
        .into_iter()
        .flat_map(|worker| worker.join().expect("benchmark worker must finish"))
        .collect::<Vec<_>>();
    report("tenant_admission_concurrent", &mut admission_samples);
}
