# InPublic Replay Pacing V2 Report

Audio: sequence-capability.wav (18.04s)

## Old scheduler

The prior sender scheduled each chunk from the previous actual send. Ordinary 3–9 ms timer overhead accumulated to 3.9–4.3 seconds by end-of-file.

## New absolute-clock scheduler

Every unsent chunk targets the current monotonic replay anchor plus its source sample start time. Scheduled-send error and source-clock drift exclude deliberate rebase delay, which is reported separately.

## Jitter policy

Normal jitter stays attached to the absolute source clock. The genuine-stall threshold is 160 ms: two complete 80 ms source chunks overdue, far above the observed 3–9 ms timer noise.

## Genuine-stall policy

Lateness beyond 160 ms rebases once at the next unsent chunk. There is no polling loop, spin wait, or queued-audio burst.

## Rebase behavior

Reconnects explicitly rebase at the next unsent source sample. Source sequence and sample identity are unchanged.

## Five clean-run results

| RUN | LEGACY INTERIM P50/P95 | LATEST-CHUNK PROXIMITY P50/P95 | GROUNDED REGION P50/P95/MAX | LIVE EDGE P50/P95/MAX | SEND LAG P50/P95/MAX | SCHEDULED ERROR P50/P95/MAX | REBASES | BUFFER MAX | LONG TASKS |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 77/87 | 69/81 | 82/1026/1026 | 80/1040/1040 | 4/12/36 | 4/12/36 | 0 | 7680 | 1 |
| 2 | 67/225 | 51/74 | 72/866/1897 | 80/670/1040 | 4/12/58 | 4/12/58 | 0 | 7680 | 0 |

## Clean send-lag comparison

Clean median send lag P50/P95/max: 4/12/58 ms.

Checkpoint medians at source 10/30/60/87 seconds: 6/0/1/6 ms.

## Provider live-edge after pacing fix

Clean-run median P50/P95: 80/1040 ms.

## Grounded provider-region latency

Clean-run median P50/P95: 82/1026 ms.

## Legacy interimLag after pacing fix

Clean-run median P50/P95: 77/225 ms. This remains a legacy comparison metric, not a causal provider measurement.

## WebSocket buffer behavior

Clean-run maximum: 7680 bytes.

## Reconnect run

Not run.

## Two-reconnect run

Not run.

## Transcript continuity

Clean/one-close/two-close character counts: 1299/—/—. Reconnect-boundary loss is measured but intentionally unchanged.

## Main-thread behavior

Long tasks across clean runs: 1.

## Tests

Deterministic coverage includes non-accumulating jitter, 1,100 chunks of repeated overhead, one-time stall rebase, next-unsent resume, no duplicate/skip/burst, reconnect rebase, clean non-rebasing, and production-capture exclusion.
