# Bms_postgres Changes and Usage Manual

## Overview

This document summarizes the recent changes made to the `Bms_postgres` project and explains how to use the system.

The application is an Express server that:
- uses SSH to connect to a remote host
- executes PostgreSQL commands over SSH
- connects to Cassandra through an SSH tunnel
- supports saving BMS data and streaming Cassandra query results
- dynamically selects Cassandra tables based on a request parameter

---

## Key Changes

### 1. Dynamic Cassandra table selection

Updated `src/routes/dataRoutes.js` to choose the Cassandra `tableName` based on `tableIdentifier`:
- `raw` → `Bacnet_Values_36c27828d0b44f1e8a94d962d342e7c2`
- `v2` → `Datapoint_Live_monitoring_36c27828d0b44f1e8a94d962d342e7c2`
- `v3` → `Datapoint_Live_monitoring_Values36c27828d0b44f1e8a94d962d342e7c2`

Invalid `tableIdentifier` values now result in a `400` response.

### 2. `dataRoutes.js` improvements

- Added validation to `/save_bms_data`:
  - `buildingId` is required
  - `onboardedData` must be a non-empty array
- Added a proper success response with `rowsInserted`
- Cleaned up unused imports and stray code
- Implemented dynamic Cassandra query table selection for `/get-table-data`

### 3. Cassandra tunnel and client initialization

Updated `src/db.js` for robust Cassandra connection handling:
- uses `tunnel-ssh` to create an SSH tunnel
- uses OS-assigned local ports to avoid port conflicts
- waits until the local tunnel port is ready before connecting
- initializes Cassandra client only once and reuses it
- exports `streamCassandraQuery` and `ensureCassandraConnection`
- avoids parallel tunnel initialization races

### 4. Server startup behavior

- `src/server.js` starts the Express server and logs the base URL
- `connectDevice()` is still called on startup from `src/services/sshServices.js`
- this ensures the SSH connection is initialized early for Postgres and Cassandra health checks

### 5. Postgres-only SSH service

`src/services/sshServices.js` handles:
- SSH connection to the remote host via `node-ssh`
- PostgreSQL health check via `psql`
- table creation if needed for BMS data
- batch insertion into `bms_data_<buildingId>` tables
- Cassandra health check using remote `cqlsh`

---

## Environment Setup

Create a `.env` file in the project root with at least the following values:

```env
REMOTE_HOST=your.ssh.jump.host
REMOTE_PORT=22
REMOTE_USER=root
REMOTE_PASSWORD=your_password
CASSANDRA_HOST=192.168.2.42
CASSANDRA_PORT=9042
CASSANDRA_USER=cassandra_user
CASSANDRA_PASSWORD=cassandra_password
CASSANDRA_DATACENTER=your_datacenter
CASSANDRA_KEYSPACE=your_keyspace
PG_HOST=127.0.0.1
PG_PORT=5432
PG_USER=postgres_user
PG_PASSWORD=postgres_password
PG_DATABASE=your_postgres_db
```

> Note: `CASSANDRA_HOST` should be the remote Cassandra host reachable from the SSH jump server.

---

## Running the App

Install dependencies (already done in your workspace):

```bash
npm install
```

Start the server:

```bash
npm run dev
```

The app listens on port `7000`.

---

## API Endpoints

### `POST /insert-data`

Simple Postgres health-check endpoint.

Request body: any valid JSON.

Response:
- `200` on success
- `500` on error

### `POST /save_bms_data`

Saves BMS data into a Postgres table named `bms_data_<buildingId>`.

Request body:

```json
{
  "buildingId": "123",
  "onboardedData": [
    {
      "site": "example-site",
      "systemType": "type",
      "systemId": "id",
      "assetCode": "code",
      "haystackTags": ["tag1", "tag2"],
      "subsystem": "ss",
      "datapoint": "dp",
      "equipmentName": "eq",
      "equipmentId": "eid",
      "unit": "unit"
    }
  ]
}
```

Response:
- `200` with `success: true` and `rowsInserted`
- `400` for invalid payload
- `500` for database errors

### `GET /check-cassandra-connection`

Validates Cassandra connectivity using remote `cqlsh` over SSH.

Response:
- `200` if Cassandra is reachable
- `500` if not

### `POST /get-table-data`

Streams data from Cassandra based on the table identifier.

Request body expected fields:
- `tableIdentifier`: `raw`, `v2`, or `v3`
- optional `buildingId`
- optional `serviceNameList` (array)
- optional `startDate`
- optional `endDate`

Example request:

```json
{
  "tableIdentifier": "v3",
  "buildingId": "123",
  "serviceNameList": ["serviceA", "serviceB"],
  "startDate": "2024-01-01",
  "endDate": "2024-01-31"
}
```

The selected table mapping is:
- `raw` → `Bacnet_Values_36c27828d0b44f1e8a94d962d342e7c2`
- `v2` → `Datapoint_Live_monitoring_36c27828d0b44f1e8a94d962d342e7c2`
- `v3` → `Datapoint_Live_monitoring_Values36c27828d0b44f1e8a94d962d342e7c2`

Response:
- `200` with streaming JSON results
- `400` for invalid `tableIdentifier`
- `500` for query or connection failures

---

## What to Change Next

- Confirm Cassandra and Postgres credentials in `.env`
- Verify that the SSH tunnel host has access to `CASSANDRA_HOST`
- Update Cassandra table names or keyspace if your environment differs
- Add column-level validation in `save_bms_data` if needed

---

## File Summary

- `src/server.js` — app startup and port configuration
- `src/app.js` — Express app setup
- `src/routes/dataRoutes.js` — API route definitions
- `src/db.js` — Cassandra SSH tunnel + query streaming
- `src/services/sshServices.js` — SSH/Postgres health and insert operations

---

## Notes

- The app uses ESM imports (`type: module` in `package.json`).
- `.env` files are ignored by `.gitignore`, so secrets are not committed.
- `node_modules` is ignored by `.gitignore`.

If you want, I can also add a short `README.md` to the repo root with this documentation.