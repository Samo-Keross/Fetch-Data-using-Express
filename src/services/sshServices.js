import { NodeSSH } from "node-ssh";
const ssh = new NodeSSH();

export const connectDevice = async () => {
  try {
    await ssh.connect({
      host: process.env.REMOTE_HOST,
      username: process.env.REMOTE_USER,
      password: process.env.REMOTE_PASSWORD,
    });
    let dbConnected = await checkDBConnectionForCassandra();
    if (!dbConnected) {
      throw new Error("Failed to connect to the database over SSH");
    }
    console.log("SSH And database connected successfully");
    return true;
  } catch (error) {
    console.error("Error connecting to SSH:", error);
    return false;
  }
};

export const checkDBConnectionForPostgres = async () => {
  try {
    if (!ssh.isConnected()) {
      const connected = await connectDevice();
      if (!connected) throw new Error("Failed to establish SSH connection");
    }
    const result = await ssh.execCommand(
      `PGPASSWORD="${process.env.PG_PASSWORD}" psql -h ${process.env.PG_HOST} -U ${process.env.PG_USER} -p ${process.env.PG_PORT} -d ${process.env.PG_DATABASE} -c "SELECT NOW();"`
    );
    if (result.code === 0) {
      console.log("Database connection is healthy");
      return true;
    } else {
      return false;
    }
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
};

// New function to check Cassandra connection using cqlsh
export const checkDBConnectionForCassandra = async () => {
  try {
    if (!ssh.isConnected()) {
      const connected = await connectDevice();
      if (!connected) throw new Error("Failed to establish SSH connection");
    }
    
    // Using cqlsh to execute a basic query against Cassandra
    const result = await ssh.execCommand(
      `cqlsh '${process.env.CASSANDRA_HOST}' '${process.env.CASSANDRA_PORT}' -u '${process.env.CASSANDRA_USER}' -p "${process.env.CASSANDRA_PASSWORD}" -e "SELECT cluster_name FROM system.local;"`
    );
    
    if (result.code === 0) {
      console.log("Cassandra database connection is healthy");
      return { success: true ,ssh};
    } else {
      // Logging standard error to help debug if the connection fails
      console.error("Cassandra Error Output:", result.stderr);
      return false;
    }
  } catch (error) {
    console.error("Error executing query:", error);
    throw error;
  }
};

export const checkTableExists = async (tableName, buildingId) => {
  try {
    const selectedTableName = `${tableName}_${buildingId}`;
const quotedTableName = `"${selectedTableName}"`; // wrap in double quotes

const sql = `
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT FROM pg_tables
    WHERE schemaname = 'public' AND tablename = '${selectedTableName}'
  ) THEN
    CREATE TABLE ${quotedTableName} (
      site TEXT,
      systemType TEXT,
      systemId TEXT,
      assetCode TEXT,
      haystackTags TEXT[],
      subsystem TEXT,
      datapoint TEXT,
      equipmentName TEXT,
      equipmentId TEXT,
      unit TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (site, systemType, systemId, equipmentName, datapoint, equipmentId)
    );
  END IF;
END $$;
`;
	
	const flatSql = sql
  .replace(/"/g, '\\"')     // escape double quotes
  .replace(/\n/g, ' ')      // flatten newlines
  .replace(/\$/g, '\\$'); 
    const result = await ssh.execCommand(
      `PGPASSWORD="${process.env.PG_PASSWORD}" psql -h ${process.env.PG_HOST} -U ${process.env.PG_USER} -p ${process.env.PG_PORT} -d ${process.env.PG_DATABASE} -c "${flatSql}"`
    );

	console.log("STDOUT:", result.stdout);
console.log("STDERR:", result.stderr);
console.log("Exit Code:", result.code);

    return result.code;
  } catch (error) {
    console.log("Error checking table", error);
  }
};


const sanitize = (value) => {
  if (value === null || typeof value === 'undefined') {
    return 'NULL';
  }

  // Handle arrays: convert them to a JSON string.
  // This is the safest way to store them in a TEXT, JSON, or JSONB column.
  if (Array.isArray(value)) {
    const jsonString = JSON.stringify(value);
    // Escape any single quotes *inside* the JSON string
    return `'${jsonString.replace(/'/g, "''")}'`;
  }

  // Handle all other types (string, number, boolean)
  const str = String(value);
  // Escape single quotes for SQL
  return `'${str.replace(/'/g, "''")}'`;
};

export const insertDataToBmsTable = async (onboardedData, buildingId) => {
  try {
    console.log("buildingId in service:", buildingId);
    console.log("onboardedData in service:", onboardedData);
    const tableName = `bms_data_${buildingId}`;

    console.log("Data received by function:", JSON.stringify(onboardedData, null, 2));

    // Batch insert logic for better performance
    const values = onboardedData.map(data => {
      const {
        site,
        systemType,
        systemId,
        assetCode,
        haystackTags,
        subsystem,
        datapoint,
        equipmentName,
        equipmentId,
        unit,
      } = data;
      console.log("Inserting data row:", data);
      return `(
        ${sanitize(site)},
        ${sanitize(systemType)},
        ${sanitize(systemId)},
        ${sanitize(assetCode)},
        ${sanitize(haystackTags)},
        ${sanitize(subsystem)},
        ${sanitize(datapoint)},
        ${sanitize(equipmentName)},
        ${sanitize(equipmentId)},
        ${sanitize(unit)}
      )`;
    }).join(", ");

    const insertSql = `
      INSERT INTO "${tableName}" (
        site, systemType, systemId, assetCode, haystackTags, 
        subsystem, datapoint, equipmentName, equipmentId, unit
      ) VALUES ${values}
      ON CONFLICT (site, systemType, systemId, equipmentName, datapoint, equipmentId) 
      DO NOTHING;
    `;

    const flatSql = insertSql
      .replace(/"/g, '\\"')   // escape double quotes for psql -c "..."
      .replace(/\n/g, ' ')       // flatten newlines
      .replace(/\$/g, '\\\$'); // escape dollars for shell

    const result = await ssh.execCommand(
      `PGPASSWORD="${process.env.PG_PASSWORD}" psql -h ${process.env.PG_HOST} -U ${process.env.PG_USER} -p ${process.env.PG_PORT} -d ${process.env.PG_DATABASE} -c "${flatSql}"`
    );

    if (result.stderr) {
      console.error("Error inserting data:", result.stderr);
    } else {
      console.log("Batch data insertion result:", result.stdout.trim());
    }
  } catch (error) {
    console.error("Error inserting data into BMS table:", error);
  }
};
