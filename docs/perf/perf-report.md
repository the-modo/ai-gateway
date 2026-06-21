# Modo AI Gateway — performance evaluation

Run: started 1781930145754 ms, finished 1781930154269 ms (wall-clock 8.5s total)

| scenario | requests | conc | TPS | p50 (ms) | p95 (ms) | p99 (ms) | errors |
|---|---:|---:|---:|---:|---:|---:|---:|
| c= 1 none x0 | 400 | 1 | 5633.8 | 0.13 | 0.33 | 0.40 | 0 |
| c= 1 keyword x5 | 400 | 1 | 8163.3 | 0.11 | 0.17 | 0.20 | 0 |
| c= 1 simple_regex x5 | 400 | 1 | 1049.9 | 0.92 | 1.14 | 1.23 | 0 |
| c= 1 heavy_regex x5 | 400 | 1 | 71.4 | 14.02 | 14.41 | 14.69 | 0 |
| c= 8 none x0 | 400 | 8 | 19047.6 | 0.39 | 0.59 | 0.87 | 0 |
| c= 8 keyword x5 | 400 | 8 | 18181.8 | 0.40 | 0.61 | 0.92 | 0 |
| c= 8 simple_regex x5 | 400 | 8 | 4938.3 | 1.47 | 2.32 | 2.85 | 0 |
| c= 8 heavy_regex x5 | 400 | 8 | 385.4 | 19.39 | 28.38 | 33.39 | 0 |
| c=32 none x0 | 400 | 32 | 28571.4 | 0.95 | 2.18 | 3.24 | 0 |
| c=32 keyword x5 | 400 | 32 | 25000.0 | 1.07 | 2.65 | 3.02 | 0 |
| c=32 simple_regex x5 | 400 | 32 | 6349.2 | 4.37 | 7.46 | 9.03 | 0 |
| c=32 heavy_regex x5 | 400 | 32 | 446.4 | 64.14 | 111.13 | 131.91 | 0 |

*p50/p95/p99 are gateway round-trip times measured client-side, with a zero-latency mock upstream so the numbers reflect gateway-induced overhead only.*
