# csv-reader-speed-01-run-20261121

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/DarelHarteraVBY2C/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/DarelHarteraVBY2C/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in for make.fun's own csv-reader 1.0.0. Built for the [make.fun csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121) ("Read broken CSV files faster", $100 in USDC for the 10 fastest entries that answer exactly like csv-reader 1.0.0).

## What it does

`solve.js` exports `run(input)`, which returns exactly csv-reader 1.0.0's `{columns, rows, errors}` for a case's `{text, header}` — same broken-row policy (BOM drop, CRLF handling, `stray_cr`, `quote_junk`, `unterminated_quote`, `short_row`, `long_row`), verified byte-identical on the kit's practice set, on 79 hand-written edge cases, and on 3,000 randomized differential tests against the reference.

`main.ts` is the harness driver: it reads every case from `/input/cases.json`, answers each with `run`, and writes `/output/answers.json`.

## How it's faster

The reference walks one character at a time and builds every field a character at a time. This reader jumps with `indexOf` to the next delimiter and slices whole fields out at once, so the common paths (a clean unquoted field, a clean quoted field) never touch a character twice. Every scan is bounded by the field or line it reads — a stray CR is found by looking at the short slice just cut, never by scanning the rest of the file. The hot path is inlined in the record loop with no call and no temporary per field.

On the kit's practice set (6 cases, ~10 MB of CSV), measured CPU time with `--no-incremental-marking` (as the harness runs): ~103 ms trimmed mean against the house baseline's ~756 ms — about 7× faster.

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<cases dir> MAKEFUN_OUTPUT_DIR=out node main.ts
```

## License

MIT. See `LICENSE`.
