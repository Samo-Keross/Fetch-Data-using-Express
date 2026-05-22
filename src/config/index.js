// import dotenv from 'dotenv';
// dotenv.config();

// import express from "express";

// import NodeSSH from "node-ssh";

// const ssh = new NodeSSH();

// const app = express();
// const port = 7000;

// app.use(express.json());

// const connectDevice = async () => {
//   try {
//     await ssh.connect({
//       host: process.env.REMOTE_HOST,
//       username: process.env.REMOTE_USER,
//       password: process.env.REMOTE_PASSWORD,
//     });
//     console.log("SSH connected successfully");
//     return true;
//   } catch (error) {
//     console.error("Error connecting to SSH:", error);
//     return false;
//   }
// };

// const executeQuery = async () => {
//   try {
//     if (!ssh.isConnected()) {
//       const connected = await connectDevice();
//       if (!connected) {
//         throw new Error("Failed to establish SSH connection");
//       }
//     }
//     let result = await ssh.execCommand(
//       `PGPASSWORD="${process.env.PG_PASSWORD}" psql -h ${process.env.PG_HOST} -U ${process.env.PG_USER} -p ${process.env.PG_PORT} -d ${process.env.PG_DATABASE} -c "SELECT NOW();"`
//     );
//     console.log("Command executed", result);
//     return result;
//   } catch (error) {
//     console.error("Error executing query:", error);
//     throw error;
//   }
// };


// app.post('/insert-data', async (req, res) => {
//   try {
//     const result = await executeQuery();
//     res.status(200).json({ success: true, data: result });
//   } catch (error) {
//     console.error("Error inserting data:", error);
//     res.status(500).json({ success: false, error: error.message });
//   }
// })

// // --- START THE SERVER ---
// app.listen(port, async () => {
//   await connectDevice();
//   console.log(`Server running on http://localhost:${port}`);
// });


import dotenv from 'dotenv';
dotenv.config();
