import express from "express";
import {
  checkDBConnectionForPostgres,
  checkTableExists,
  insertDataToBmsTable,
  checkDBConnectionForCassandra,
} from "../services/sshServices.js";
import { streamCassandraQuery } from "../db.js";

const router = express.Router();

router.post("/insert-data", async (req, res) => {
  try {
    const result = await checkDBConnectionForPostgres();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error inserting data:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/save_bms_data", async (req, res) => {
  try {
    const { buildingId, onboardedData } = req.body;

    if (!buildingId) {
      return res.status(400).json({
        success: false,
        error: "buildingId is required",
      });
    }

    if (!Array.isArray(onboardedData) || onboardedData.length === 0) {
      return res.status(400).json({
        success: false,
        error: "onboardedData must be a non-empty array",
      });
    }

    const dbConnection = await checkDBConnectionForPostgres();
    if (!dbConnection) {
      return res
        .status(500)
        .json({ success: false, error: "Database connection failed" });
    }

    console.log("save_bms_data request body:", req.body);

    const tableExists = await checkTableExists("bms_data", buildingId);
    console.log("tableExists code:", tableExists);

    if (tableExists !== 0) {
      return res.status(500).json({
        success: false,
        error: "Table creation/check failed",
      });
    }

    await insertDataToBmsTable(onboardedData, buildingId);

    return res.status(200).json({
      success: true,
      message: `Data saved to bms_data_${buildingId}`,
      rowsInserted: onboardedData.length,
    });
  } catch (error) {
    console.error("Error saving BMS data:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/check-cassandra-connection", async (req, res) => {
  try {
    const result = await checkDBConnectionForCassandra();
    res.status(200).json({ success: true, data: result });
  } catch (error) {
    console.error("Error checking Cassandra connection:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/get-table-data", async (req, res) => {
  try {
    // 1. Extract the dynamic parameters from the request body
    const {
      serviceNameList,
      site,
      startDate,
      endDate,
      timePeriod,
      buildingId,
      tableIdentifier
    } = req.body;

    const keyspaceName = "user_keyspace";
    let tableName;

    switch (tableIdentifier) {
      case "v2":
        tableName = "Datapoint_Live_monitoring_36c27828d0b44f1e8a94d962d342e7c2";
        break;
      case "v3":
        tableName = "Datapoint_Live_monitoring_Values36c27828d0b44f1e8a94d962d342e7c2";
        break;
      case "raw":
        tableName = "Bacnet_Values_36c27828d0b44f1e8a94d962d342e7c2";
        break;
      default:
        return res.status(400).json({
          success: false,
          error: "tableIdentifier must be one of 'raw', 'v2', or 'v3'",
        });
    }

    // 2. Build the dynamic WHERE clauses
    let whereClauses = [];

    // NOTE: Update 'building_id', 'service_name', and 'timestamp' to match your actual Cassandra column names!
    if (buildingId) {
      whereClauses.push(`building_id = '${buildingId}'`); 
    }

    if (serviceNameList && Array.isArray(serviceNameList) && serviceNameList.length > 0) {
      // Wrap strings in single quotes for CQL syntax
      const services = serviceNameList.map((s) => `'${s}'`).join(", ");
      whereClauses.push(`service_name IN (${services})`);
    }

    if (startDate) {
      whereClauses.push(`timestamp >= ${startDate}`);
    }

    if (endDate) {
      whereClauses.push(`timestamp <= ${endDate}`);
    }

    // 3. Construct the final query string
    let whereClauseStr = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
    
    // Append ALLOW FILTERING since dynamic queries might not hit exact partition keys.
    const query = `SELECT * FROM ${keyspaceName}.${tableName} ${whereClauseStr} limit 15 ALLOW FILTERING;`;

    console.log("Executing dynamic query:", query);

    // 4. Stream the data directly to the client
    res.setHeader("Content-Type", "application/json");
    const stream = await streamCassandraQuery(query);

    res.write('{"success":true,"data":[');
    let isFirstRow = true;

    // Listen for data events and write them to the response as they arrive
    stream.on("readable", function () {
      let row;
      while ((row = this.read())) {
        if (!isFirstRow) {
          res.write(",");
        }
        res.write(JSON.stringify(row));
        isFirstRow = false;
      }
    });

    // When the stream ends, close the JSON array and end the response
    stream.on("end", function () {
      res.write("]}");
      res.end();
    });

    stream.on("error", function (error) {
      console.error("[get-table-data] Stream Error:", error.message);
      // If headers haven't been sent, we can still send a clean 500 error
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: "Failed to fetch data from Cassandra.",
        });
      } else {
        // Otherwise, forcefully close the broken JSON array and end the response
        res.end("]}");
      }
    });
  } catch (error) {
    console.error("Error fetching table data:", error);
    // Ensure we only send headers if they haven't been sent already
    if (!res.headersSent) {
      res.status(500).json({ 
          success: false, 
          error: error.message || "An unexpected error occurred." 
      });
    }
  }
});
export default router;
