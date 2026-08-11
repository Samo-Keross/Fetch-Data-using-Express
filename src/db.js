import net from 'net';
import { createTunnel } from 'tunnel-ssh';
import cassandra from 'cassandra-driver';
import dotenv from 'dotenv';

dotenv.config();

let client = null;
let isConnecting = false;          // prevents parallel init races
let connectionPromise = null;      // single shared promise during init

// Use port 0 so the OS picks a free port — avoids "already in use" conflicts
const serverOptions = {
  host: '127.0.0.1',
  port: 0,
};

const sshOptions = {
  host: process.env.REMOTE_HOST,
  port: parseInt(process.env.REMOTE_PORT, 10) || 22,
  username: process.env.REMOTE_USER,
  password: process.env.REMOTE_PASSWORD,
};

// dstPort is the Cassandra port on the REMOTE side
const forwardOptions = {
  srcAddr: '127.0.0.1',
  srcPort: 0,                                                    // OS picks local src port too
  dstAddr: process.env.CASSANDRA_HOST || '127.0.0.1',
  dstPort: parseInt(process.env.CASSANDRA_PORT, 10) || 9042,
};

const tunnelOptions = {
  autoClose: false,   // FIX 1: keep tunnel alive for the lifetime of the app
};

// ─── Helpers ────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Polls until the local tunnel port accepts TCP connections.
 * Throws if all retries are exhausted — callers must handle this.
 */
const waitForLocalPort = async (host, port, retries = 10, delayMs = 600) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const connected = await new Promise((resolve) => {
      const socket = net.connect({ host, port }, () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => {
        socket.destroy();
        resolve(false);
      });
    });

    if (connected) {
      console.log(`[db] Tunnel port ${port} is ready (attempt ${attempt}).`);
      return;
    }

    console.log(`[db] Waiting for tunnel port ${port}... attempt ${attempt}/${retries}`);
    await sleep(delayMs);
  }

  // FIX 2: actually throw so callers know the port never came up
  throw new Error(
    `[db] Tunnel port ${port} not accepting connections after ${retries} attempts.`
  );
};

// ─── Core init ───────────────────────────────────────────────────────────────

async function initCassandraWithTunnel() {
  console.log('[db] Creating SSH tunnel...', { sshOptions, forwardOptions });

  const [server] = await createTunnel(
    tunnelOptions,
    serverOptions,
    sshOptions,
    forwardOptions
  );

  const { port: localPort } = server.address();
  console.log(`[db] SSH Tunnel established on local port ${localPort}.`);

  // FIX 3: wait for port — and actually propagate failure
  await waitForLocalPort('127.0.0.1', localPort, 10, 600);

  const authProvider = new cassandra.auth.PlainTextAuthProvider(
    process.env.CASSANDRA_USER,
    process.env.CASSANDRA_PASSWORD
  );

  const cassandraClient = new cassandra.Client({
    contactPoints: ['127.0.0.1'],
    localDataCenter: process.env.CASSANDRA_DATACENTER,
    keyspace: process.env.CASSANDRA_KEYSPACE,
    authProvider,
    socketOptions: {
      connectTimeout: 30000,
      readTimeout:    30000,
    },
    protocolOptions: {
      port: localPort,   // FIX 4: use the actual dynamically assigned port
    },
  });

  await cassandraClient.connect();
  console.log('[db] Cassandra connected via SSH Tunnel!');

  // FIX 5: only assign to the module-level `client` AFTER connect() succeeds
  client = cassandraClient;

  // Keep the tunnel alive: restart on unexpected close
  server.on('close', () => {
    console.warn('[db] SSH tunnel closed unexpectedly. Resetting client...');
    client = null;
    connectionPromise = null;
  });

  return client;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Returns the existing Cassandra client, or initialises one.
 * Multiple concurrent callers share a single init promise (no duplicate tunnels).
 */
const ensureCassandraConnection = async () => {
  if (client) return client;

  // FIX 6: serialise parallel calls so only one tunnel is ever created
  if (!connectionPromise) {
    connectionPromise = initCassandraWithTunnel().catch((err) => {
      // Reset so the next call can retry
      connectionPromise = null;
      client = null;
      throw err;
    });
  }

  return connectionPromise;
};

async function streamCassandraQuery(user_query) {
  const cassandraClient = await ensureCassandraConnection();

  const query =
    user_query ||
    'SELECT * FROM it_live_monitoring_56b5c2666a0f437a82b93715bb6f3d4c LIMIT 10';

  return cassandraClient.stream(query, [], {
    prepare:   true,
    fetchSize: 5000,
  });
}

export async function executePagedQuery(
    query,
    pageSize = 5000,
    pagingState = null
) {

  const cassandraClient = await ensureCassandraConnection();

  const result = await cassandraClient.execute(
      query,
      [],
      {
        prepare: true,
        fetchSize: pageSize,
        pageState: pagingState || undefined,
      }
  );

  return {
    rows: result.rows,
    pagingState: result.pageState,
    hasMore: !!result.pageState,
  };
}

export default initCassandraWithTunnel;
export { streamCassandraQuery, ensureCassandraConnection};