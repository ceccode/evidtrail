import { join } from 'path';
import {
  BLAME_STREAM_SCHEMA_VERSION,
  BlameStream,
  COMMIT_STREAM_SCHEMA_VERSION,
  CommitStream,
  METRICS_SCHEMA_VERSION,
  PR_STREAM_SCHEMA_VERSION,
  PRStream,
  readVersionedJSON,
} from '@evidtrail/core';
import { Metrics } from '@evidtrail/metrics';

// One reader per artifact the CLI passes between its commands. Each knows
// its file name, its schema version and which command rewrites it, so a
// reader of an old file is told exactly what to rerun.

export function readCommitStream(outDir: string): Promise<CommitStream> {
  return readVersionedJSON(
    join(outDir, 'commit-stream.json'),
    CommitStream,
    COMMIT_STREAM_SCHEMA_VERSION,
    "Rerun 'evidtrail collect' with this version of evidtrail."
  );
}

export function readMetrics(outDir: string): Promise<Metrics> {
  return readVersionedJSON(
    join(outDir, 'metrics.json'),
    Metrics,
    METRICS_SCHEMA_VERSION,
    "Rerun 'evidtrail analyze' with this version of evidtrail."
  );
}

export function readPRStream(path: string): Promise<PRStream> {
  return readVersionedJSON(
    path,
    PRStream,
    PR_STREAM_SCHEMA_VERSION,
    "Rerun 'evidtrail fetch-prs' with this version of evidtrail."
  );
}

export function readBlameStream(path: string): Promise<BlameStream> {
  return readVersionedJSON(
    path,
    BlameStream,
    BLAME_STREAM_SCHEMA_VERSION,
    "Rerun 'evidtrail blame' with this version of evidtrail."
  );
}
