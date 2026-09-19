### PR123 — 120 ops, quote latency 0 ms, history latency 0 ms, live frame, in-memory repository (2026-09-19T13:29:49.767Z)

| contracts | command | total p50 / p95 / max | engine p50 / p95 | market wait p50 / p95 | repository wait p50 / p95 | serialize p50 | quotes / frame reads / history (p50) | repo calls (p50) | response p95 | payload per commit | fills (OPEN filled/partial/rejected) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OPEN | 6.64 ms / 10.35 ms / 11.51 ms | 2.77 ms / 6.4 ms | 0.04 ms / 0.09 ms | 3.06 ms / 7.16 ms | 0.11 ms | 1 / 0 / 0 | 4 | 113 KB | 352 KB | 55 / 0 / 0 |
| 1 | CLOSE | 6.5 ms / 9.07 ms / 10.72 ms | 2.79 ms / 5.9 ms | 0.03 ms / 0.06 ms | 3 ms / 5.47 ms | 0.1 ms | 1 / 0 / 0 | 4 | 113 KB | 352 KB |  |
| 1 | CLOSE_FULL | 5.68 ms / 6.79 ms / 6.79 ms | 2.21 ms / 3.45 ms | 0.03 ms / 0.04 ms | 2.34 ms / 4.56 ms | 0.07 ms | 1 / 0 / 0 | 4 | 113 KB | 352 KB |  |
| 1 | OPEN_NEW | 7.11 ms / 8.76 ms / 8.76 ms | 2.5 ms / 6.07 ms | 0.04 ms / 0.06 ms | 3.54 ms / 4.75 ms | 0.09 ms | 1 / 0 / 0 | 4 | 113 KB | 352 KB |  |
| 1 | REDUCE_LIMIT | 7.12 ms / 11.5 ms / 11.5 ms | 3.05 ms / 5.99 ms | 0.04 ms / 0.09 ms | 3.56 ms / 5.47 ms | 0.12 ms | 1 / 0 / 0 | 4 | 113 KB | 352 KB |  |
| 1 | CANCEL | 5.68 ms / 10.67 ms / 10.67 ms | 2.6 ms / 5.52 ms | 0 ms / 0.07 ms | 2.69 ms / 5.14 ms | 0.12 ms | 0 / 0 / 0 | 4 | 113 KB | 352 KB |  |
| 1 | REFRESH | 2.67 ms / 3.81 ms / 3.81 ms | 1.81 ms / 3.39 ms | 0.02 ms / 0.13 ms | 0.56 ms / 1.29 ms | 0.08 ms | 0 / 1 / 0 | 3 | 113 KB | 352 KB |  |
| 10 | OPEN | 9.82 ms / 16.05 ms / 21 ms | 5.53 ms / 9.46 ms | 0.04 ms / 0.13 ms | 4.34 ms / 7.1 ms | 0.12 ms | 1 / 1 / 0 | 4 | 131 KB | 620 KB | 54 / 0 / 0 |
| 10 | CLOSE | 9.05 ms / 15.11 ms / 22.71 ms | 5.23 ms / 9.13 ms | 0.03 ms / 0.05 ms | 4.64 ms / 7.34 ms | 0.12 ms | 1 / 1 / 0 | 4 | 131 KB | 620 KB |  |
| 10 | CLOSE_FULL | 8.24 ms / 14.26 ms / 14.26 ms | 3.53 ms / 6.52 ms | 0.03 ms / 0.03 ms | 4.33 ms / 7.72 ms | 0.11 ms | 1 / 1 / 0 | 4 | 131 KB | 620 KB |  |
| 10 | OPEN_NEW | 9.43 ms / 18.7 ms / 18.7 ms | 5.79 ms / 9.09 ms | 0.05 ms / 0.06 ms | 4.5 ms / 9.55 ms | 0.12 ms | 1 / 1 / 0 | 4 | 131 KB | 620 KB |  |
| 10 | REDUCE_LIMIT | 11.34 ms / 19.69 ms / 19.69 ms | 6.02 ms / 9.09 ms | 0.04 ms / 0.14 ms | 4.2 ms / 10.54 ms | 0.12 ms | 1 / 1 / 0 | 4 | 131 KB | 620 KB |  |
| 10 | CANCEL | 8.87 ms / 14.71 ms / 14.71 ms | 4.81 ms / 7.87 ms | 0.01 ms / 0.01 ms | 4.05 ms / 7.38 ms | 0.11 ms | 0 / 1 / 0 | 4 | 131 KB | 620 KB |  |
| 10 | REFRESH | 4.61 ms / 6.23 ms / 6.23 ms | 3.77 ms / 5.83 ms | 0.01 ms / 0.01 ms | 1.1 ms / 1.75 ms | 0.09 ms | 0 / 1 / 0 | 3 | 131 KB | 620 KB |  |
| 20 | OPEN | 43.51 ms / 82.17 ms / 87.01 ms | 24.18 ms / 51.49 ms | 0.11 ms / 0.48 ms | 17.94 ms / 34.3 ms | 0.35 ms | 1 / 1 / 0 | 4 | 149 KB | 915 KB | 55 / 0 / 0 |
| 20 | CLOSE | 44.45 ms / 67.06 ms / 80.64 ms | 25.05 ms / 43.29 ms | 0.08 ms / 0.13 ms | 16.69 ms / 33.29 ms | 0.32 ms | 1 / 1 / 0 | 4 | 149 KB | 915 KB |  |
| 20 | CLOSE_FULL | 31.9 ms / 54.48 ms / 54.48 ms | 17.56 ms / 24.76 ms | 0.07 ms / 0.09 ms | 16.72 ms / 29.63 ms | 0.3 ms | 1 / 1 / 0 | 4 | 149 KB | 915 KB |  |
| 20 | OPEN_NEW | 42.52 ms / 54.36 ms / 54.36 ms | 23.33 ms / 37.27 ms | 0.11 ms / 0.16 ms | 16.98 ms / 20.11 ms | 0.37 ms | 1 / 1 / 0 | 4 | 149 KB | 915 KB |  |
| 20 | REDUCE_LIMIT | 40.99 ms / 72.27 ms / 72.27 ms | 24.53 ms / 38.25 ms | 0.1 ms / 0.12 ms | 16.35 ms / 33.89 ms | 0.32 ms | 1 / 1 / 0 | 4 | 149 KB | 915 KB |  |
| 20 | CANCEL | 44.43 ms / 64.84 ms / 64.84 ms | 26.02 ms / 38.71 ms | 0.02 ms / 0.04 ms | 19.59 ms / 28.03 ms | 0.35 ms | 0 / 1 / 0 | 4 | 149 KB | 915 KB |  |
| 20 | REFRESH | 19.31 ms / 42.43 ms / 42.43 ms | 18.32 ms / 36.97 ms | 0.03 ms / 0.22 ms | 4.38 ms / 9.12 ms | 0.32 ms | 0 / 1 / 0 | 3 | 149 KB | 915 KB |  |
| 30 | OPEN | 69.58 ms / 101.64 ms / 109.08 ms | 45.3 ms / 73.2 ms | 0.12 ms / 0.58 ms | 24.08 ms / 37.02 ms | 0.42 ms | 1 / 1 / 0 | 4 | 168 KB | 1211 KB | 55 / 0 / 0 |
| 30 | CLOSE | 67.71 ms / 101.79 ms / 118.49 ms | 41.77 ms / 72.01 ms | 0.09 ms / 0.17 ms | 24.9 ms / 38.32 ms | 0.39 ms | 1 / 1 / 0 | 4 | 168 KB | 1211 KB |  |
| 30 | CLOSE_FULL | 70.45 ms / 86.22 ms / 86.22 ms | 41.57 ms / 61.27 ms | 0.09 ms / 0.16 ms | 24.59 ms / 28.78 ms | 0.34 ms | 1 / 1 / 0 | 4 | 168 KB | 1211 KB |  |
| 30 | OPEN_NEW | 60.08 ms / 90.03 ms / 90.03 ms | 40.52 ms / 55.31 ms | 0.12 ms / 0.13 ms | 20.32 ms / 34.59 ms | 0.38 ms | 1 / 1 / 0 | 4 | 168 KB | 1211 KB |  |
| 30 | REDUCE_LIMIT | 69.28 ms / 86.6 ms / 86.6 ms | 43.71 ms / 58.43 ms | 0.12 ms / 0.17 ms | 26.48 ms / 36.38 ms | 0.5 ms | 1 / 1 / 0 | 4 | 168 KB | 1211 KB |  |
| 30 | CANCEL | 70.91 ms / 87.07 ms / 87.07 ms | 42.24 ms / 57.81 ms | 0.04 ms / 0.05 ms | 26.23 ms / 36.08 ms | 0.37 ms | 0 / 1 / 0 | 4 | 168 KB | 1211 KB |  |
| 30 | REFRESH | 35.63 ms / 65.06 ms / 65.06 ms | 31.4 ms / 57.3 ms | 0.03 ms / 0.07 ms | 5.96 ms / 7.72 ms | 0.37 ms | 0 / 1 / 0 | 3 | 168 KB | 1211 KB |  |

### Candidate — 120 ops, quote latency 0 ms, history latency 0 ms, live frame, in-memory repository (2026-09-19T13:30:41.212Z)

| contracts | command | total p50 / p95 / max | engine p50 / p95 | market wait p50 / p95 | repository wait p50 / p95 | serialize p50 | quotes / frame reads / history (p50) | repo calls (p50) | response p95 | payload per commit | fills (OPEN filled/partial/rejected) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | OPEN | 6.67 ms / 11.54 ms / 12.13 ms | 3.28 ms / 6.43 ms | 0.04 ms / 0.11 ms | 3.35 ms / 7.1 ms | 0.09 ms | 1 / 0 / 0 | 4 | 114 KB | 410 KB | 55 / 0 / 0 |
| 1 | CLOSE | 6.18 ms / 9.86 ms / 14.41 ms | 3.12 ms / 5.8 ms | 0.02 ms / 0.05 ms | 3.07 ms / 5.94 ms | 0.09 ms | 1 / 0 / 0 | 4 | 114 KB | 410 KB |  |
| 1 | CLOSE_FULL | 5.87 ms / 8.03 ms / 8.03 ms | 2.74 ms / 3.72 ms | 0.02 ms / 0.05 ms | 3.28 ms / 4.87 ms | 0.09 ms | 1 / 0 / 0 | 4 | 114 KB | 410 KB |  |
| 1 | OPEN_NEW | 5.16 ms / 8.48 ms / 8.48 ms | 2.62 ms / 3.45 ms | 0.03 ms / 0.06 ms | 3.1 ms / 4.99 ms | 0.07 ms | 1 / 0 / 0 | 4 | 114 KB | 410 KB |  |
| 1 | REDUCE_LIMIT | 7 ms / 9.83 ms / 9.83 ms | 3 ms / 3.82 ms | 0.04 ms / 0.06 ms | 3.97 ms / 6.03 ms | 0.11 ms | 1 / 0 / 0 | 4 | 114 KB | 410 KB |  |
| 1 | CANCEL | 5.56 ms / 9.57 ms / 9.57 ms | 2.72 ms / 3.5 ms | 0 ms / 0.03 ms | 2.95 ms / 6.44 ms | 0.14 ms | 0 / 0 / 0 | 4 | 114 KB | 410 KB |  |
| 1 | REFRESH | 2.65 ms / 3.83 ms / 3.83 ms | 1.65 ms / 2.69 ms | 0.02 ms / 0.11 ms | 0.52 ms / 1.45 ms | 0.06 ms | 0 / 1 / 0 | 3 | 114 KB | 410 KB |  |
| 10 | OPEN | 12.25 ms / 32.37 ms / 42.84 ms | 7.21 ms / 16.89 ms | 0.04 ms / 0.2 ms | 5.57 ms / 19.66 ms | 0.12 ms | 1 / 1 / 0 | 4 | 132 KB | 884 KB | 54 / 0 / 0 |
| 10 | CLOSE | 13.05 ms / 31.26 ms / 40.13 ms | 7.73 ms / 14.39 ms | 0.03 ms / 0.06 ms | 5.8 ms / 18.14 ms | 0.11 ms | 1 / 1 / 0 | 4 | 132 KB | 884 KB |  |
| 10 | CLOSE_FULL | 10.29 ms / 22.79 ms / 22.79 ms | 5.13 ms / 10.18 ms | 0.03 ms / 0.04 ms | 4.77 ms / 12.57 ms | 0.1 ms | 1 / 1 / 0 | 4 | 132 KB | 884 KB |  |
| 10 | OPEN_NEW | 12.21 ms / 25.54 ms / 25.54 ms | 6.45 ms / 13.68 ms | 0.05 ms / 0.06 ms | 6.46 ms / 11.81 ms | 0.13 ms | 1 / 1 / 0 | 4 | 132 KB | 884 KB |  |
| 10 | REDUCE_LIMIT | 14.13 ms / 43.33 ms / 43.33 ms | 7.06 ms / 18.9 ms | 0.05 ms / 0.15 ms | 6.75 ms / 26.01 ms | 0.14 ms | 1 / 1 / 0 | 4 | 132 KB | 884 KB |  |
| 10 | CANCEL | 12.53 ms / 45.32 ms / 45.32 ms | 5.84 ms / 19.03 ms | 0.01 ms / 0.01 ms | 5.8 ms / 28.17 ms | 0.1 ms | 0 / 1 / 0 | 4 | 132 KB | 884 KB |  |
| 10 | REFRESH | 5.96 ms / 12.95 ms / 12.95 ms | 4.86 ms / 8.25 ms | 0.01 ms / 0.01 ms | 1.1 ms / 4.69 ms | 0.08 ms | 0 / 1 / 0 | 3 | 132 KB | 884 KB |  |
| 20 | OPEN | 55.05 ms / 84.48 ms / 90.43 ms | 31.04 ms / 45.91 ms | 0.11 ms / 0.48 ms | 26.03 ms / 43.92 ms | 0.33 ms | 1 / 1 / 0 | 4 | 150 KB | 1434 KB | 55 / 0 / 0 |
| 20 | CLOSE | 53.69 ms / 82.28 ms / 86.31 ms | 30.61 ms / 45.52 ms | 0.08 ms / 0.14 ms | 24 ms / 42.07 ms | 0.34 ms | 1 / 1 / 0 | 4 | 150 KB | 1434 KB |  |
| 20 | CLOSE_FULL | 46.31 ms / 61.82 ms / 61.82 ms | 28.75 ms / 31.93 ms | 0.08 ms / 0.08 ms | 22.37 ms / 32.29 ms | 0.27 ms | 1 / 1 / 0 | 4 | 150 KB | 1434 KB |  |
| 20 | OPEN_NEW | 41.38 ms / 79.79 ms / 79.79 ms | 27.17 ms / 43.61 ms | 0.1 ms / 0.12 ms | 21.39 ms / 39.51 ms | 0.28 ms | 1 / 1 / 0 | 4 | 150 KB | 1434 KB |  |
| 20 | REDUCE_LIMIT | 57.7 ms / 78.2 ms / 78.2 ms | 26.55 ms / 52.92 ms | 0.1 ms / 0.11 ms | 25.18 ms / 40.54 ms | 0.4 ms | 1 / 1 / 0 | 4 | 150 KB | 1434 KB |  |
| 20 | CANCEL | 68.69 ms / 103.14 ms / 103.14 ms | 35.55 ms / 48.11 ms | 0.03 ms / 0.09 ms | 24.79 ms / 55 ms | 0.32 ms | 0 / 1 / 0 | 4 | 150 KB | 1434 KB |  |
| 20 | REFRESH | 29.78 ms / 37.88 ms / 37.88 ms | 23.73 ms / 35.42 ms | 0.02 ms / 0.44 ms | 4.88 ms / 10.03 ms | 0.28 ms | 0 / 1 / 0 | 3 | 150 KB | 1434 KB |  |
| 30 | OPEN | 86.2 ms / 130.02 ms / 173.37 ms | 46.58 ms / 82.69 ms | 0.12 ms / 0.67 ms | 34.16 ms / 61.13 ms | 0.41 ms | 1 / 1 / 0 | 4 | 169 KB | 1994 KB | 55 / 0 / 0 |
| 30 | CLOSE | 82.97 ms / 117.49 ms / 163.43 ms | 47.62 ms / 73.04 ms | 0.09 ms / 0.15 ms | 36.62 ms / 54.81 ms | 0.4 ms | 1 / 1 / 0 | 4 | 169 KB | 1994 KB |  |
| 30 | CLOSE_FULL | 69.14 ms / 121.97 ms / 121.97 ms | 41.82 ms / 64.84 ms | 0.09 ms / 0.09 ms | 29.82 ms / 57.04 ms | 0.34 ms | 1 / 1 / 0 | 4 | 169 KB | 1994 KB |  |
| 30 | OPEN_NEW | 78.31 ms / 154.51 ms / 154.51 ms | 46.29 ms / 93.76 ms | 0.12 ms / 0.19 ms | 37.5 ms / 60.56 ms | 0.51 ms | 1 / 1 / 0 | 4 | 169 KB | 1994 KB |  |
| 30 | REDUCE_LIMIT | 78.1 ms / 133.46 ms / 133.46 ms | 48.76 ms / 67.09 ms | 0.12 ms / 0.15 ms | 32.27 ms / 66.25 ms | 0.38 ms | 1 / 1 / 0 | 4 | 169 KB | 1994 KB |  |
| 30 | CANCEL | 79.45 ms / 118.32 ms / 118.32 ms | 49.38 ms / 57.01 ms | 0.03 ms / 0.05 ms | 32.52 ms / 61.26 ms | 0.38 ms | 0 / 1 / 0 | 4 | 169 KB | 1994 KB |  |
| 30 | REFRESH | 44.27 ms / 60.55 ms / 60.55 ms | 33.8 ms / 54.16 ms | 0.03 ms / 0.04 ms | 8.43 ms / 11.98 ms | 0.34 ms | 0 / 1 / 0 | 3 | 169 KB | 1994 KB |  |
